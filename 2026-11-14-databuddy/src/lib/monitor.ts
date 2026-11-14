import { getDb } from "./db";
import { newId } from "./ids";
import { listGoals } from "./repo";
import { writeDigest } from "./digest";

export type Thresholds = { minPct: number; minBase: number };
export const DEFAULT_THRESHOLDS: Thresholds = { minPct: 20, minBase: 20 };

export type Metrics = {
  visitors: number;
  pageviews: number;
  sessions: number;
  bounceRate: number;
  errors: number;
  goals: Record<string, number>;
  pages: Record<string, number>;
  referrers: Record<string, number>;
};

export type Change = {
  kind: "metric" | "goal" | "page" | "referrer";
  label: string;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number;
};

/** Meaningful = relative change of at least minPct on a base of at least minBase. */
export function isMeaningful(current: number, previous: number, t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  if (previous < t.minBase) return false;
  return (Math.abs(current - previous) / previous) * 100 >= t.minPct;
}

function change(kind: Change["kind"], label: string, current: number, previous: number): Change {
  return { kind, label, current, previous, delta: current - previous, deltaPct: previous ? ((current - previous) / previous) * 100 : 0 };
}

const topMovers = (kind: Change["kind"], cur: Record<string, number>, prev: Record<string, number>): Change[] =>
  [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
    .map((k) => change(kind, k, cur[k] ?? 0, prev[k] ?? 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);

export function detectChanges(cur: Metrics, prev: Metrics, t: Thresholds = DEFAULT_THRESHOLDS): Change[] {
  const candidates: Change[] = [
    change("metric", "Visitors", cur.visitors, prev.visitors),
    change("metric", "Pageviews", cur.pageviews, prev.pageviews),
    change("metric", "Sessions", cur.sessions, prev.sessions),
    change("metric", "JS errors", cur.errors, prev.errors),
    ...Object.keys({ ...cur.goals, ...prev.goals }).map((g) => change("goal", g, cur.goals[g] ?? 0, prev.goals[g] ?? 0)),
    ...topMovers("page", cur.pages, prev.pages),
    ...topMovers("referrer", cur.referrers, prev.referrers),
  ];
  // Bounce rate is a ratio: its base is the previous period's session count.
  const bounce = change("metric", "Bounce rate (%)", cur.bounceRate * 100, prev.bounceRate * 100);
  const keep = candidates.filter((c) => isMeaningful(c.current, c.previous, t));
  if (isMeaningful(cur.bounceRate, prev.bounceRate, { ...t, minBase: 0 }) && prev.sessions >= t.minBase) keep.push(bounce);
  return keep.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
}

function periodMetrics(siteId: string, from: string, to: string): Metrics {
  const db = getDb();
  const one = <T>(sql: string, ...p: unknown[]) => db.prepare(sql).get(siteId, from, to, ...p) as T;
  const base = one<{ visitors: number; pageviews: number; sessions: number }>(
    `SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
     FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts < ?`,
  );
  const bounce = one<{ sessions: number; bounces: number }>(
    `SELECT COUNT(*) AS sessions, COALESCE(SUM(pv = 1), 0) AS bounces FROM (
       SELECT COUNT(*) AS pv FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts < ? GROUP BY session_id)`,
  );
  const errors = one<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND type = 'error' AND ts >= ? AND ts < ?").n;
  const goals: Record<string, number> = {};
  for (const g of listGoals(siteId)) {
    const cond = g.kind === "path" ? "type = 'pageview' AND path = ?" : "type = 'event' AND name = ?";
    goals[g.name] = one<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE site_id = ? AND ts >= ? AND ts < ? AND ${cond}`, g.target).n;
  }
  const grouped = (col: string, extra: string) =>
    Object.fromEntries(
      (db.prepare(`SELECT ${col} AS k, COUNT(*) AS n FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts < ? ${extra} GROUP BY k`).all(siteId, from, to) as { k: string; n: number }[]).map((r) => [r.k, r.n]),
    );
  return {
    ...base,
    bounceRate: bounce.sessions ? bounce.bounces / bounce.sessions : 0,
    errors,
    goals,
    pages: grouped("path", ""),
    referrers: grouped("referrer_host", "AND referrer_host != ''"),
  };
}

/** Last 7 full UTC days vs the 7 before. */
export function computePeriods(siteId: string, now = new Date()) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (days: number) => new Date(midnight - days * 86_400_000).toISOString();
  return {
    current: periodMetrics(siteId, iso(7), iso(0)),
    previous: periodMetrics(siteId, iso(14), iso(7)),
    window: { from: iso(7), to: iso(0) },
  };
}

export type InsightRow = {
  id: string; site_id: string; created_at: string; period_days: number;
  changes: Change[]; digest_md: string; sent_to_slack: boolean;
};

async function postToSlack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runMonitor(siteId: string, siteName: string, now = new Date()): Promise<InsightRow> {
  const { current, previous, window } = computePeriods(siteId, now);
  const changes = detectChanges(current, previous);
  const digest_md = await writeDigest(siteName, window, changes, current, previous);
  const sent = await postToSlack(digest_md);
  const row: InsightRow = { id: newId(), site_id: siteId, created_at: now.toISOString(), period_days: 7, changes, digest_md, sent_to_slack: sent };
  getDb()
    .prepare("INSERT INTO insights (id, site_id, created_at, period_days, changes, digest_md, sent_to_slack) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, siteId, row.created_at, 7, JSON.stringify(changes), digest_md, sent ? 1 : 0);
  return row;
}

export function listInsights(siteId: string): InsightRow[] {
  const rows = getDb().prepare("SELECT * FROM insights WHERE site_id = ? ORDER BY created_at DESC").all(siteId) as (Omit<InsightRow, "changes" | "sent_to_slack"> & { changes: string; sent_to_slack: number })[];
  return rows.map((r) => ({ ...r, changes: JSON.parse(r.changes) as Change[], sent_to_slack: !!r.sent_to_slack }));
}
