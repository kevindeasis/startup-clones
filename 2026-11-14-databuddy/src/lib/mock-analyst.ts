import type { ChartSpec } from "./types";

export type MockPlan = {
  sql: string;
  chart: ChartSpec;
  title: string;
  windowLabel: string;
  fellBack: boolean;
  headline: (rows: Record<string, unknown>[]) => string;
};

type Window = { clause: string; label: string; explicit: boolean };

const DAY = 86_400_000;

function parseWindow(q: string, now: Date): Window {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const iso = (ms: number) => `'${new Date(ms).toISOString()}'`;
  if (/yesterday/.test(q)) return { clause: `ts >= ${iso(midnight - DAY)} AND ts < ${iso(midnight)}`, label: "yesterday", explicit: true };
  if (/today/.test(q)) return { clause: `ts >= ${iso(midnight)}`, label: "today", explicit: true };
  if (/24 ?h|day ago|last day/.test(q)) return { clause: `ts >= ${iso(now.getTime() - DAY)}`, label: "the last 24 hours", explicit: true };
  if (/week|7 days|7d/.test(q)) return { clause: `ts >= ${iso(now.getTime() - 7 * DAY)}`, label: "the last 7 days", explicit: true };
  const explicit = /30 days|month|30d/.test(q);
  return { clause: `ts >= ${iso(now.getTime() - 30 * DAY)}`, label: "the last 30 days", explicit };
}

const num = (v: unknown) => Number(v ?? 0).toLocaleString("en-US");
const first = (rows: Record<string, unknown>[], key: string) => String(rows[0]?.[key] ?? "");
const topLine = (what: string, key: string, valueKey: string) => (rows: Record<string, unknown>[]) =>
  rows.length ? `**${first(rows, key)}** leads with ${num(rows[0][valueKey])} ${what}.` : "No matching data in that period.";

function grouped(opts: {
  title: string; w: Window; dim: string; expr?: string; metric: string; measure: string;
  where?: string; what: string; n: number;
}): MockPlan {
  const { title, w, dim, metric, measure, what, n } = opts;
  const expr = opts.expr ?? dim;
  return {
    title, windowLabel: w.label, fellBack: false,
    sql: `SELECT ${expr} AS ${dim}, ${measure} AS ${metric}
FROM events
WHERE site_id = :site AND ${opts.where ?? "type = 'pageview'"} AND ${w.clause}
GROUP BY 1
ORDER BY ${metric} DESC
LIMIT ${n}`,
    chart: { type: "bar", x: dim, y: metric, title },
    headline: topLine(what, dim, metric),
  };
}

function perDay(title: string, w: Window, metric: string, measure: string, where: string, what: string): MockPlan {
  return {
    title, windowLabel: w.label, fellBack: false,
    sql: `SELECT date(ts) AS day, ${measure} AS ${metric}
FROM events
WHERE site_id = :site AND ${where} AND ${w.clause}
GROUP BY day
ORDER BY day
LIMIT 200`,
    chart: { type: "line", x: "day", y: metric, title },
    headline: (rows) => {
      const total = rows.reduce((s, r) => s + Number(r[metric] ?? 0), 0);
      return `${num(total)} ${what} across ${rows.length} days (sum of daily values).`;
    },
  };
}

function signupsByReferrer(w: Window, event: string, n: number): MockPlan {
  return {
    title: `${event} by referrer`, windowLabel: w.label, fellBack: false,
    sql: `WITH src AS (
  SELECT session_id, COALESCE(NULLIF(MAX(referrer_host), ''), 'direct') AS referrer
  FROM events WHERE site_id = :site AND type = 'pageview' GROUP BY session_id
)
SELECT src.referrer AS referrer, COUNT(*) AS conversions
FROM events e JOIN src ON src.session_id = e.session_id
WHERE e.site_id = :site AND e.type = 'event' AND e.name = '${event}' AND ${w.clause.replace(/\bts\b/g, "e.ts")}
GROUP BY src.referrer
ORDER BY conversions DESC
LIMIT ${n}`,
    chart: { type: "bar", x: "referrer", y: "conversions", title: `${event} by referrer` },
    headline: (rows) =>
      rows.length ? `**${first(rows, "referrer")}** brought the most \`${event}\` conversions (${num(rows[0].conversions)}).` : `No \`${event}\` events in that period.`,
  };
}

/** Deterministic keyword planner standing in for the LLM when no API key is set. */
export function planMock(question: string, now = new Date()): MockPlan {
  const q = question.toLowerCase();
  const w = parseWindow(q, now);
  const n = Math.min(50, Number(q.match(/top\s+(\d+)/)?.[1] ?? 10)) || 10;
  const event = /purchase|sale|bought/.test(q) ? "purchase" : "signup";
  const isEvent = /sign ?-?ups?|purchase|sale|conversion|event/.test(q);

  if (isEvent && /referr|source|channel|where|come from|brought/.test(q)) return signupsByReferrer(w, event, n);
  if (/referr|channel|traffic (from|source)|where .*(from|come)/.test(q))
    return grouped({ title: "Top referrers", w, dim: "referrer", expr: "COALESCE(NULLIF(referrer_host, ''), 'direct')", metric: "visitors", measure: "COUNT(DISTINCT visitor_id)", what: "visitors", n });
  if (/utm|campaign/.test(q))
    return grouped({ title: "Top UTM campaigns", w, dim: "campaign", expr: "utm_campaign", metric: "visitors", measure: "COUNT(DISTINCT visitor_id)", where: "type = 'pageview' AND utm_campaign IS NOT NULL AND utm_campaign != ''", what: "visitors", n });
  if (/\b(pages?|paths?|urls?)\b/.test(q))
    return grouped({ title: "Top pages", w, dim: "path", metric: "pageviews", measure: "COUNT(*)", what: "pageviews", n });
  if (/countr|geo|region/.test(q))
    return grouped({ title: "Visitors by country", w, dim: "country", metric: "visitors", measure: "COUNT(DISTINCT visitor_id)", what: "visitors", n });
  if (/browser/.test(q))
    return grouped({ title: "Visitors by browser", w, dim: "browser", metric: "visitors", measure: "COUNT(DISTINCT visitor_id)", what: "visitors", n });
  if (/device|mobile|desktop|tablet/.test(q))
    return grouped({ title: "Visitors by device", w, dim: "device", metric: "visitors", measure: "COUNT(DISTINCT visitor_id)", what: "visitors", n });
  if (/error|exception|crash|bug/.test(q))
    return grouped({ title: "Most frequent JS errors", w, dim: "name", metric: "occurrences", measure: "COUNT(*)", where: "type = 'error'", what: "occurrences", n });
  if (isEvent) return perDay(`${event} events per day`, w, "conversions", "COUNT(*)", `type = 'event' AND name = '${event}'`, `\`${event}\` events`);
  if (/pageview|views/.test(q)) return perDay("Pageviews per day", w, "pageviews", "COUNT(*)", "type = 'pageview'", "pageviews");
  if (/visitor|traffic|users?|session/.test(q)) return perDay("Visitors per day", w, "visitors", "COUNT(DISTINCT visitor_id)", "type = 'pageview'", "visitors");

  const plan = perDay("Visitors per day", w, "visitors", "COUNT(DISTINCT visitor_id)", "type = 'pageview'", "visitors");
  return { ...plan, fellBack: true };
}

export function mockAnswer(plan: MockPlan, rows: Record<string, unknown>[]): string {
  const intro = plan.fellBack
    ? `I could not map that question to one of my built-in analyses (mock mode has ~10 templates), so here is daily visitors for ${plan.windowLabel} instead. Set \`ANTHROPIC_API_KEY\` for free-form questions.`
    : `**${plan.title}** for ${plan.windowLabel}.`;
  return `${intro}\n\n${plan.headline(rows)}`;
}
