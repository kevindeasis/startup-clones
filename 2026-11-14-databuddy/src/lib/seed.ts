import { getDb } from "./db";
import { createFunnel, createGoal, createSite, getSite, listFunnels, listGoals } from "./repo";
import { SESSION_GAP_MS } from "./visitor";

const DAY = 86_400_000;
const PATHS = ["/", "/pricing", "/features", "/blog", "/blog/cookieless-analytics", "/docs", "/docs/install", "/about", "/signup", "/changelog", "/contact", "/login"];
const PATH_WEIGHTS = [30, 14, 10, 8, 6, 8, 5, 3, 6, 3, 2, 5];
const REFERRERS: [string, number, string?][] = [
  ["google.com", 30], ["twitter.com", 10], ["github.com", 10], ["producthunt.com", 8],
  ["", 28], ["newsletter.example.org", 6, "newsletter"], ["news.ycombinator.com", 8],
];
const COUNTRIES: [string, number][] = [["US", 40], ["GB", 10], ["DE", 9], ["IN", 9], ["CA", 6], ["FR", 5], ["BR", 5], ["AU", 4], ["NL", 3], ["JP", 3], ["Unknown", 6]];
const BROWSERS: [string, number][] = [["Chrome", 62], ["Safari", 20], ["Firefox", 8], ["Edge", 7], ["Other", 3]];
const DEVICES: [string, number][] = [["desktop", 58], ["mobile", 37], ["tablet", 5]];
const ERRORS = ["TypeError: Cannot read properties of undefined (reading 'map')", "ReferenceError: analytics is not defined", "Error: Network request failed", "SyntaxError: Unexpected token '<' in JSON"];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SeedRow = {
  ts: number; type: string; path: string; name?: string | null; referrer?: string | null; host?: string;
  us?: string | null; um?: string | null; uc?: string | null; props?: string | null; value?: number | null;
};

export type SeedResult = { seeded: boolean; events: number };

/** Idempotent: skips when the demo site already has events. */
export function seedDemo(now = new Date()): SeedResult {
  const db = getDb();
  if (!getSite("demo")) createSite("Hutch demo site", "demo.example.com", "demo");
  const existing = (db.prepare("SELECT COUNT(*) AS n FROM events WHERE site_id = 'demo'").get() as { n: number }).n;
  if (existing > 0) return { seeded: false, events: existing };

  const rnd = mulberry32(20261114);
  const pick = <T,>(items: [T, number, ...unknown[]][], boost: (v: T) => number = () => 1): [T, number, ...unknown[]] => {
    const weights = items.map((i) => i[1] * boost(i[0]));
    let r = rnd() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < items.length; i++) if ((r -= weights[i]) < 0) return items[i];
    return items[items.length - 1];
  };
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
  const insert = db.prepare(`INSERT INTO events
    (site_id, ts, type, name, path, referrer, referrer_host, utm_source, utm_medium, utm_campaign,
     country, browser, os, device, screen_w, visitor_id, session_id, props, value)
    VALUES ('demo', @ts, @type, @name, @path, @referrer, @host, @us, @um, @uc, @country, @browser, @os, @device, @screen, @visitor, @session, @props, @value)`);

  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let total = 0;
  db.transaction(() => {
    for (let offset = 29; offset >= 0; offset--) {
      const dayStart = midnight - offset * DAY;
      const weekday = new Date(dayStart).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const recent = offset < 7;
      const sessions = Math.round((150 + rnd() * 250) * (weekend ? 0.6 : 1) * (1 + (29 - offset) * 0.004));
      const returning = Array.from({ length: Math.ceil(sessions / 4) }, () => hex(16));
      for (let s = 0; s < sessions; s++) {
        const visitor = rnd() < 0.2 ? returning[Math.floor(rnd() * returning.length)] : hex(16);
        const start = dayStart + Math.floor(rnd() * DAY);
        if (start > now.getTime()) continue;
        const session = `${visitor}${Math.floor(start / SESSION_GAP_MS)}`;
        const [host, , utm] = pick(REFERRERS, (h) => (recent && h === "producthunt.com" ? 1.4 : 1)) as [string, number, string?];
        const [country] = pick(COUNTRIES);
        const [browser] = pick(BROWSERS);
        const [device] = pick(DEVICES);
        const os = device === "mobile" ? (rnd() < 0.55 ? "iOS" : "Android") : pick([["Windows", 50], ["macOS", 38], ["Linux", 12]])[0];
        const base = { country, browser, os, device, screen: device === "mobile" ? 390 : 1440, visitor, session };
        const put = (e: SeedRow) => {
          insert.run({ ...base, name: null, props: null, value: null, referrer: null, host: "", us: null, um: null, uc: null, ...e, ts: new Date(e.ts).toISOString() });
          total++;
        };

        const views = 1 + Math.floor(rnd() * rnd() * 6);
        let t = start;
        let lastPath = "/";
        let signedUp = false;
        for (let v = 0; v < views; v++) {
          const path = v === 0 && rnd() < 0.4 ? "/" : (pick(PATHS.map((p, i) => [p, PATH_WEIGHTS[i]] as [string, number]), (p) => (recent && p === "/pricing" ? 2 : 1))[0] as string);
          lastPath = path;
          const first = v === 0;
          put({
            ts: t, type: "pageview", path,
            ...(first && host ? { referrer: `https://${host}/`, host } : {}),
            ...(first && utm ? { us: utm, um: "email", uc: "weekly-digest" } : {}),
            ...(first && host === "producthunt.com" ? { us: "producthunt", um: "referral", uc: "launch" } : {}),
          });
          if (first && rnd() < 0.55) put({ ts: t + 1500, type: "vital", path, name: "LCP", value: Math.round(900 + rnd() * rnd() * 4000) });
          if (rnd() < 0.01 / views) {
            put({ ts: t + 800, type: "error", path, name: ERRORS[Math.floor(rnd() * ERRORS.length)], props: JSON.stringify({ stack: "at render (app.js:1:1)" }) });
          }
          t += 20_000 + Math.floor(rnd() * 120_000);
        }
        if (rnd() < 0.03 * (views > 2 ? 1.6 : 0.8)) {
          if (!signedUp) put({ ts: t, type: "event", path: lastPath, name: "signup", props: JSON.stringify({ plan: rnd() < 0.3 ? "pro" : "free" }) });
          signedUp = true;
        }
        if (rnd() < 0.01) put({ ts: t + 30_000, type: "event", path: lastPath, name: "purchase", value: rnd() < 0.5 ? 9.99 : 29 });
      }
    }
  })();

  if (!listFunnels("demo").length) {
    createFunnel("demo", "Visit to signup", [{ kind: "path", value: "/" }, { kind: "path", value: "/pricing" }, { kind: "event", value: "signup" }], "demo-funnel");
  }
  if (!listGoals("demo").length) {
    createGoal("demo", "Signups", "event", "signup", "goal-signup");
    createGoal("demo", "Viewed pricing", "path", "/pricing", "goal-pricing");
  }
  return { seeded: true, events: total };
}
