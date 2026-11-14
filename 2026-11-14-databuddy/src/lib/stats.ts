import { getDb } from "./db";
import { windowFor, type RangeWindow } from "./range";
import type { Range } from "./types";

type Named = { name: string; visitors: number };

function rows<T>(sql: string, ...params: unknown[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

function bucketKeys(w: RangeWindow): string[] {
  const keys: string[] = [];
  const step = w.bucket === "hour" ? 3_600_000 : 86_400_000;
  const end = Date.parse(w.to);
  let t = Date.parse(w.from);
  t -= t % step;
  for (; t <= end; t += step) keys.push(new Date(t).toISOString().slice(0, w.bucket === "hour" ? 13 : 10));
  return keys;
}

function topBy(site: string, w: RangeWindow, column: string, empty?: string): Named[] {
  const where = empty === undefined ? `AND ${column} IS NOT NULL AND ${column} != ''` : "";
  return rows<Named>(
    `SELECT COALESCE(NULLIF(${column}, ''), ?) AS name, COUNT(DISTINCT visitor_id) AS visitors
     FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ? ${where}
     GROUP BY 1 ORDER BY visitors DESC LIMIT 10`,
    empty ?? "", site, w.from, w.to,
  );
}

export function getStats(site: string, range: Range, now = new Date()) {
  const w = windowFor(range, now);
  const span = w.bucket === "hour" ? 13 : 10;
  const totals = rows<{ visitors: number; pageviews: number; sessions: number }>(
    `SELECT COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
     FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ?`,
    site, w.from, w.to,
  )[0];
  const bounce = rows<{ sessions: number; bounces: number }>(
    `SELECT COUNT(*) AS sessions, COALESCE(SUM(pv = 1), 0) AS bounces FROM (
       SELECT COUNT(*) AS pv FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ? GROUP BY session_id)`,
    site, w.from, w.to,
  )[0];
  const errors = rows<{ n: number }>(
    "SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND type = 'error' AND ts >= ? AND ts <= ?",
    site, w.from, w.to,
  )[0].n;

  const series = new Map(bucketKeys(w).map((k) => [k, { t: k, visitors: 0, pageviews: 0 }]));
  for (const r of rows<{ t: string; visitors: number; pageviews: number }>(
    `SELECT substr(ts, 1, ${span}) AS t, COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS pageviews
     FROM events WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ? GROUP BY t`,
    site, w.from, w.to,
  )) series.set(r.t, r);

  return {
    range,
    from: w.from,
    to: w.to,
    bucket: w.bucket,
    visitors: totals.visitors,
    pageviews: totals.pageviews,
    sessions: totals.sessions,
    bounceRate: bounce.sessions ? bounce.bounces / bounce.sessions : 0,
    pagesPerSession: bounce.sessions ? totals.pageviews / bounce.sessions : 0,
    errors,
    series: [...series.values()],
    topPages: rows<{ path: string; pageviews: number; visitors: number }>(
      `SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_id) AS visitors FROM events
       WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ? GROUP BY path ORDER BY pageviews DESC LIMIT 10`,
      site, w.from, w.to,
    ),
    topReferrers: rows<{ host: string; visitors: number }>(
      `SELECT referrer_host AS host, COUNT(DISTINCT visitor_id) AS visitors FROM events
       WHERE site_id = ? AND type = 'pageview' AND ts >= ? AND ts <= ? AND referrer_host != ''
       GROUP BY host ORDER BY visitors DESC LIMIT 10`,
      site, w.from, w.to,
    ),
    topUtmSources: topBy(site, w, "utm_source"),
    topUtmCampaigns: topBy(site, w, "utm_campaign"),
    countries: topBy(site, w, "country", "Unknown"),
    browsers: topBy(site, w, "browser", "Other"),
    devices: topBy(site, w, "device", "desktop"),
    recentErrors: rows<{ name: string; path: string; count: number; last_seen: string }>(
      `SELECT name, path, COUNT(*) AS count, MAX(ts) AS last_seen FROM events
       WHERE site_id = ? AND type = 'error' AND ts >= ? AND ts <= ? GROUP BY name, path ORDER BY last_seen DESC LIMIT 10`,
      site, w.from, w.to,
    ),
  };
}

export function getRealtime(site: string, now = new Date()) {
  const since = new Date(now.getTime() - 5 * 60_000).toISOString();
  const counts = rows<{ visitors: number; pageviews: number }>(
    `SELECT COUNT(DISTINCT visitor_id) AS visitors, COALESCE(SUM(type = 'pageview'), 0) AS pageviews
     FROM events WHERE site_id = ? AND ts >= ?`,
    site, since,
  )[0];
  const events = rows<{ ts: string; type: string; name: string | null; path: string; country: string }>(
    "SELECT ts, type, name, path, country FROM events WHERE site_id = ? ORDER BY ts DESC, id DESC LIMIT 10",
    site,
  );
  return { ...counts, events };
}
