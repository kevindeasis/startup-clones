import { getDb } from "./db";
import { windowFor } from "./range";
import type { Funnel, Goal, Range, Step } from "./types";

export type FunnelEvent = { session_id: string; type: string; name: string | null; path: string | null };

export const matchesStep = (e: FunnelEvent, s: Pick<Step, "kind" | "value">): boolean =>
  s.kind === "path" ? e.type === "pageview" && e.path === s.value : e.type === "event" && e.name === s.value;

/** Events must be ordered by time. Step n counts only sessions that hit step n-1 earlier in the same session. */
export function computeFunnelCounts(steps: Step[], events: FunnelEvent[]): number[] {
  const bySession = new Map<string, FunnelEvent[]>();
  for (const e of events) {
    const list = bySession.get(e.session_id);
    if (list) list.push(e);
    else bySession.set(e.session_id, [e]);
  }
  const counts = steps.map(() => 0);
  for (const list of bySession.values()) {
    let next = 0;
    for (const e of list) {
      if (next < steps.length && matchesStep(e, steps[next])) {
        counts[next]++;
        next++;
      }
    }
  }
  return counts;
}

export function funnelResults(funnel: Funnel, range: Range, now = new Date()) {
  const w = windowFor(range, now);
  const events = getDb()
    .prepare(
      `SELECT session_id, type, name, path FROM events
       WHERE site_id = ? AND type IN ('pageview','event') AND ts >= ? AND ts <= ? ORDER BY ts, id`,
    )
    .all(funnel.site_id, w.from, w.to) as FunnelEvent[];
  const counts = computeFunnelCounts(funnel.steps, events);
  const steps = funnel.steps.map((s, i) => ({
    ...s,
    count: counts[i],
    fromPrevious: i === 0 ? 1 : counts[i - 1] ? counts[i] / counts[i - 1] : 0,
  }));
  return { funnel, range, steps, overall: counts[0] ? counts[counts.length - 1] / counts[0] : 0 };
}

export function goalResults(siteId: string, goals: Goal[], range: Range, now = new Date()) {
  const w = windowFor(range, now);
  const db = getDb();
  const total = (
    db.prepare("SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE site_id = ? AND ts >= ? AND ts <= ?").get(siteId, w.from, w.to) as { n: number }
  ).n;
  return goals.map((g) => {
    const cond = g.kind === "path" ? "type = 'pageview' AND path = ?" : "type = 'event' AND name = ?";
    const conversions = (
      db.prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE site_id = ? AND ts >= ? AND ts <= ? AND ${cond}`).get(siteId, w.from, w.to, g.target) as { n: number }
    ).n;
    return { ...g, conversions, sessions: total, rate: total ? conversions / total : 0 };
  });
}
