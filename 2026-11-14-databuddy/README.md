# Hutch - a Databuddy clone

> **Independent learning clone built for education. It is not affiliated with, endorsed by, or derived from the code of Databuddy.** "Hutch" and "Bunny" are placeholder names used here so nothing is confused with the real product.

## What the original does

[Databuddy](https://www.databuddy.cc) ([YC page](https://www.ycombinator.com/companies/databuddy), YC Fall 2026) is cookieless product and web analytics for startups, with a built-in AI data analyst called "Databunny". You add one script tag and it records visitors, sessions, page views, custom events, referrers, UTM campaigns, JS errors and Web Vitals without cookies. The dashboard shows real-time visitors, traffic over time, top pages / referrers / countries / browsers, funnels and goals. Databunny answers plain-language questions ("which referrer brought the most signups last week?") and shows the query it ran so you can check the number. On paid plans it also watches metrics on a schedule and posts meaningful changes with suggested next steps to Slack. The product also has an MCP server, feature flags, short links and uptime monitoring. Pricing is free up to 10K events/month, then from $9.99/mo. Buyers are early-stage teams without a data person who are leaving GA, Plausible or PostHog.

## What this clone does

- **Tracker** (`public/track.js`, ~100 lines, vanilla JS): pageviews incl. SPA navigation, custom events (`window.hutch.track`), JS errors, LCP, UTM parsing, `sendBeacon` with `fetch` fallback, honours Do Not Track, no cookies and no localStorage.
- **Collect endpoint** (`POST /api/collect`): zod validation, server-derived cookieless daily-rotating visitor id, 30-minute sessions, UA parsing, country from proxy headers.
- **Dashboard**: tiles (visitors, pageviews, sessions, bounce, pages/session, errors), real-time visitors (polled every 10 s), time series, top pages, referrers, UTM sources/campaigns, countries, browsers, devices, recent errors.
- **Funnels and goals**: ordered 2-5 step funnels computed per session, goals with conversion rate.
- **Bunny, the AI analyst**: question -> read-only SQL -> result table + chart, with the SQL always shown.
- **Monitor**: last 7 full days vs the 7 before, meaningful changes, a Markdown digest with next steps, optional Slack webhook, and a cron endpoint.
- **Seed data**: 30 days of synthetic traffic with a deliberate anomaly (Product Hunt referrals and `/pricing` traffic up in the last week) and a `/demo-page` to generate live events.

**Skipped on purpose:** auth, billing, multi-tenant orgs, feature flags, short links, uptime monitoring, MCP server, email, GeoIP database (country comes from the `cf-ipcountry`, `x-vercel-ip-country` or `x-country` header, else "Unknown"), CLS/INP vitals.

## Architecture

```
 browser page ──track.js──▶ POST /api/collect ──▶ ingest(): zod, UA, visitor/session ids ─┐
                                                                                         ▼
 Next.js App Router UI ◀── /api/sites/[id]/{stats,realtime,funnels,goals} ◀──────── SQLite (data/hutch.db)
        │                                                                                ▲   ▲
        ├─ /ask ──▶ POST /api/sites/[id]/ask ──▶ analyst ──┬─ mock planner (no key)      │   │ read-only
        │                                                  └─ AI SDK generateText ──┐    │   │ connection
        │                                                       tool run_sql ◀───────┘    │   │
        │                         every query ──▶ sql-guard.guardSql() ──▶ runReadOnlySql ─┘───┘
        └─ /insights ──▶ POST /api/sites/[id]/monitor ──▶ detectChanges() ──▶ digest (LLM | template) ──▶ insights table (+ Slack)
```

Source map: `src/lib/` holds the logic (`db`, `collect`, `visitor`, `ua`, `stats`, `funnels`, `monitor`, `digest`, `sql-guard`, `analyst`, `analyst-llm`, `mock-analyst`, `llm`, `seed`), `src/app/api/` the route handlers, `src/components/` the client UI, `tests/` the vitest suites, `scripts/` the seed and e2e scripts.

## GitHub tools used

| Library | Link | What it covers |
|---|---|---|
| Next.js 16 | https://github.com/vercel/next.js | App Router UI and API route handlers |
| React 19 | https://github.com/facebook/react | UI |
| Tailwind CSS 4 | https://github.com/tailwindlabs/tailwindcss | Styling |
| Vercel AI SDK (`ai` v7) | https://github.com/vercel/ai | `generateText`, `tool`, `stopWhen: stepCountIs()` for the analyst tool loop and the digest |
| `@ai-sdk/anthropic` v4 | https://github.com/vercel/ai/tree/main/packages/anthropic | Claude provider |
| zod 4 | https://github.com/colinhacks/zod | Collect payload, API bodies, analyst answer and chart schemas |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | Persistence; a second `readonly` connection runs analyst queries |
| Recharts 3 | https://github.com/recharts/recharts | Time-series and bar charts |
| Vitest | https://github.com/vitest-dev/vitest | Unit tests |
| tsx | https://github.com/privatenumber/tsx | Runs `scripts/seed.ts` |
| Playwright | https://github.com/microsoft/playwright | `scripts/e2e.mjs` (expected to be installed globally, not a dependency) |

`ua-parser-js` is deliberately not used (AGPL); `src/lib/ua.ts` is a small hand-written regex helper.

## Setup and run

Requires Node 22 and npm 10.

```bash
npm install                 # builds better-sqlite3's native module
cp .env.example .env.local  # optional; everything has a default
npm run seed                # creates data/hutch.db with the "demo" site and 30 days of data
npm run dev                 # http://localhost:3000   (or: npm run build && npm start)
```

Other scripts: `npm test`, `npm run lint`, `npm run e2e` (needs a running server on :3000, the seeded demo site and a global Playwright install; set `BASE_URL` to change the origin).

If the database has no sites, the home page offers a "Seed demo data" button (`POST /api/seed`), which runs the same code as `npm run seed`.

Try it: open `/demo-page`, click the buttons, then watch `/sites/demo`. Create your own site on `/`, copy the snippet from its Setup tab, and use "Send test event".

If `better-sqlite3` fails to compile on your machine, run `npm rebuild better-sqlite3`; the fallback would be Node 22's built-in `node:sqlite` behind the same `src/lib/db.ts` interface (not needed here, the native build worked).

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | When empty the app runs in mock mode. When set, the real model powers the analyst and the digest. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model id. |
| `SALT_SECRET` | `change-me` | Salts the daily-rotating visitor id. Use a random string. |
| `SLACK_WEBHOOK_URL` | empty | If set, monitor digests are POSTed as `{text}`. |
| `CRON_SECRET` | empty | Token for `GET /api/cron/monitor?token=...`. The endpoint refuses all requests while this is empty. |
| `DATABASE_PATH` | `./data/hutch.db` | SQLite file. |

## Mock mode

`isMockMode()` in `src/lib/llm.ts` is true when `ANTHROPIC_API_KEY` is empty, and the UI shows a banner. Nothing is faked at the data layer:

- **Analyst:** `src/lib/mock-analyst.ts` is a deterministic keyword planner (time words like today / yesterday / last week / last 30 days, "top N", referrer, signups by referrer, pages, countries, browsers, devices, errors, UTM campaigns, event or pageview or visitor series). It emits a parameterised SQL template that is executed through the same `runReadOnlySql` guard and rendered by the same UI, so answers are real numbers from real SQL. Unknown questions fall back to daily visitors and say so.
- **Digest:** a Markdown template built from the computed changes (no LLM).

With a key, the analyst runs `generateText` with a `run_sql` tool (`inputSchema` zod object, up to 4 tool steps plus the final answer via `stopWhen: stepCountIs(5)`). The final message must be JSON matching `AnalystAnswer`; it is parsed with zod, retried once with a repair prompt, then falls back to plain text. The recorded `sql` and `rows` come from the last successful `run_sql` call. The real-model path is type-checked against the installed `ai` v7 but was not exercised here because no API key was available.

## SQL guard design

Every analyst query, from the model or from the mock planner, goes through `src/lib/sql-guard.ts`:

1. Strip comments and a trailing semicolon; reject any other `;` (one statement only).
2. Must start with `SELECT` or `WITH`.
3. Reject `INSERT UPDATE DELETE DROP ALTER CREATE ATTACH DETACH PRAGMA REPLACE VACUUM REINDEX TRIGGER load_extension sqlite_master randomblob readfile writefile` as whole words, case-insensitive (checked after blanking string literals, so `name = 'create'` is fine).
4. Table allow-list: tokens after `FROM`/`JOIN` (including comma joins, aliases, schema-qualified names) must be `events`, `sites`, `funnels`, `goals` or a CTE defined in the query.
5. The text must contain `site_id = :site` (also accepts `@site` or `?`, normalised to `:site`); the site id is bound as a parameter, never concatenated. The error message tells the model exactly how to fix a missing filter.
6. Append `LIMIT 200` when no `LIMIT` exists; rows are also capped at 200 in the runner.
7. Execute on a separate `{ readonly: true }` connection with `query_only = ON` and a 2 s busy timeout, so even a guard bypass cannot write.

## Known limitations

- The site filter check is textual: a query such as `WHERE site_id = :site OR 1=1` passes the guard. Hutch is single-user without auth, so this is a correctness aid, not a tenant boundary. A real multi-tenant version should query through per-site views or temp tables.
- The real-LLM path is untested against the live API (no key in the build environment).
- A 2 s busy timeout bounds waiting on locks but not a slow query; there is no statement timeout.
- Visitor ids hash IP + User-Agent, so users behind one NAT with the same UA collapse into one visitor.
- Country needs a CDN/proxy header; locally it is "Unknown" (the seed data has countries).
- Only LCP is collected (no CLS/INP), and UTM is only read on the first pageview of a visit.
- Bounce rate = sessions with exactly one pageview; sessions use a 30-minute inactivity gap.
- No auth, rate limiting or bot filtering on `/api/collect`.
- The Markdown renderer supports only headings, bullets, bold and inline code.

## Next 3 things to build

1. **MCP server exposing the analyst and stats to coding agents** (tools: `ask`, `get_stats`, `run_monitor`).
2. Scheduled monitoring built in (cron inside the app instead of an external scheduler) with per-site Slack settings and alert thresholds in the UI.
3. Auth plus multi-site teams, with per-site SQL views so the analyst's site isolation is structural rather than textual.
