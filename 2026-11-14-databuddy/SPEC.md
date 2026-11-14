# Databuddy clone — build spec (2026-11-14)

## What the original product does
Databuddy (YC Fall 2026, https://www.databuddy.cc, YC page https://www.ycombinator.com/companies/databuddy)
is cookieless product/web analytics for startups with a built-in **AI data analyst called "Databunny"**.
You install one script tag; it records visitors, sessions, page views, custom events, referrers, UTM
campaigns, JS errors and Web Vitals without cookies. The dashboard shows real-time visitors, traffic over
time, top pages/referrers/countries/browsers, funnels and goals. Databunny answers plain-language questions
about the data ("which referrer brought the most signups last week?") and **shows the query it ran so you
can check the number**. On paid plans it also checks metrics daily/weekly and posts meaningful changes with
suggested next steps to Slack. There is also an MCP server for coding agents, feature flags, short links
and uptime monitoring (all out of scope here). Pricing is free up to 10K events/month, then from $9.99/mo.
Buyers: early-stage founders and small teams without a data person, switching from GA / Plausible / PostHog.

## What the clone builds ("Hutch" — an independent learning clone, not affiliated)
A self-hostable web app with (1) a cookieless tracking script + collect endpoint, (2) an analytics
dashboard, (3) funnels and goals, (4) a **"Bunny" AI analyst** that turns a question into a read-only SQL
query over the events table, runs it, shows the SQL + result table + chart, and (5) a **monitor** that
compares the last 7 days with the previous 7, finds meaningful changes and writes a digest with next steps
(optionally POSTed to a Slack incoming webhook). A seed script generates 30 days of realistic demo data and
a `/demo-page` route lets you generate live events from a browser.

## Stack (fixed)
- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4, `npm`. Scaffold with
  `npx create-next-app@latest . --ts --app --eslint --tailwind --src-dir --no-import-alias --use-npm`
  (or hand-write the equivalent files) inside the project folder.
- Vercel AI SDK: `ai` (v7.x), `@ai-sdk/anthropic` (v4.x). Use `generateText` with **tool calling** (a
  `run_sql` tool) for the analyst and `generateText` (plain) for the monitor digest. Default model id
  `claude-sonnet-5-5`, overridable with `ANTHROPIC_MODEL`. Check the installed package's type definitions
  before writing code; use only exports that exist in the installed major version.
- `zod` for all schemas (collect payload, API bodies, analyst answer shape, chart spec).
- `better-sqlite3` for persistence (single file `data/hutch.db`, created on first run, gitignored). Plain
  SQL, no ORM. Open a **second read-only connection** (`{ readonly: true }`) for analyst queries.
- `recharts` for charts (time series line/area chart, bar charts, funnel bars).
- `vitest` for unit tests.
- Tracker: a hand-written vanilla JS file `public/track.js` (~150 lines, no framework, no cookies, no
  localStorage). No third-party analytics SDK. UA parsing: a small hand-written regex helper in
  `src/lib/ua.ts` (browser: Chrome/Safari/Firefox/Edge/Other; OS: Windows/macOS/iOS/Android/Linux/Other;
  device: desktop/mobile/tablet). Do NOT add `ua-parser-js` (AGPL).
- No auth, no billing, no multi-tenant orgs, no feature flags, no short links, no uptime monitoring, no
  MCP server, no email, no GeoIP database (country comes from `cf-ipcountry` / `x-vercel-ip-country` /
  `x-country` request headers, else "Unknown"; the seed script fills in realistic countries).

## Mock mode (required — assume no API key is present)
`src/lib/llm.ts` exposes `isMockMode()` = `!process.env.ANTHROPIC_API_KEY`. In mock mode:
- The analyst uses a deterministic rule-based planner (`src/lib/mock-analyst.ts`): keyword matching
  ("top pages", "referrer", "visitors", "pageviews", "country", "browser", "error", "signup"/event name,
  "today"/"yesterday"/"last week"/"last 30 days") maps to one of ~10 parameterised SQL templates, which are
  then executed through the SAME guarded `runReadOnlySql` path and rendered through the same UI, so the
  answer is real data with real SQL. Unknown questions fall back to a daily visitors/pageviews query and say
  so in the answer text.
- The monitor digest is a templated Markdown summary built from the computed changes (no LLM).
- The UI shows a small "Mock mode — set ANTHROPIC_API_KEY for the real AI analyst" banner.
With a key present, the real model is used for the analyst (tool-calling loop) and for the digest. Both
paths share the same zod schemas, the same SQL guard and the same UI.

## Data model (SQLite)
- `sites(id TEXT PK, name TEXT, domain TEXT, created_at TEXT)`
- `events(id INTEGER PK, site_id TEXT, ts TEXT (ISO), type TEXT CHECK(type IN ('pageview','event','error','vital')),
   name TEXT, path TEXT, referrer TEXT, referrer_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
   country TEXT, browser TEXT, os TEXT, device TEXT, screen_w INTEGER, visitor_id TEXT, session_id TEXT,
   props TEXT (JSON), value REAL)` with indexes on `(site_id, ts)`, `(site_id, type, name)`, `(site_id, session_id)`.
  - `visitor_id` = first 16 hex chars of sha256(`${dailySalt}|${site_id}|${ip}|${userAgent}`) where
    `dailySalt` = sha256(`${SALT_SECRET}|${YYYY-MM-DD}`) — cookieless, rotates daily (Plausible-style).
  - `session_id` = `visitor_id` + the 30-minute bucket of the first event, computed server-side: reuse the
    visitor's latest session if its last event is < 30 min ago, else start a new one.
- `funnels(id TEXT PK, site_id TEXT, name TEXT, steps TEXT (JSON array of {kind:'path'|'event', value}))`
- `goals(id TEXT PK, site_id TEXT, name TEXT, kind TEXT ('path'|'event'), target TEXT)`
- `insights(id TEXT PK, site_id TEXT, created_at TEXT, period_days INTEGER, changes TEXT (JSON), digest_md TEXT, sent_to_slack INTEGER)`
- `questions(id TEXT PK, site_id TEXT, created_at TEXT, question TEXT, answer_md TEXT, sql TEXT, chart TEXT (JSON), rows TEXT (JSON), mode TEXT ('mock'|'llm'))`

## Core user flows (implement all five)
1. **Create a site & install** (`/` → create form → `/sites/[id]/setup`): name + domain. Setup page shows
   the snippet `<script defer src="http://localhost:3000/track.js" data-site="SITE_ID"></script>` (origin
   from the request) with a copy button, the custom-event API `window.hutch.track('signup', {plan:'pro'})`,
   and a "Send test event" button that fires a pageview from the setup page itself so the user can see it
   arrive in real time.
2. **Dashboard** (`/sites/[id]`, default range 30d, selector 24h / 7d / 30d; the dashboard fetches
   `GET /api/sites/[id]/stats?range=7d`): stat tiles (visitors, pageviews, sessions, bounce rate, avg
   pages/session, JS errors), **real-time visitors** (distinct visitors in last 5 min, polled every 10 s),
   time-series chart (visitors + pageviews per day, or per hour for 24h), top pages, top referrers (host),
   top UTM sources/campaigns, countries, browsers, devices, recent errors (name + path + count).
3. **Funnels & goals** (`/sites/[id]/funnels`): create a funnel with 2–5 ordered steps (path or event);
   results computed per session in order (`step n` counted only for sessions that completed `step n-1`
   earlier in the same session); show per-step count, conversion from previous step, overall conversion,
   as horizontal bars. Create goals (path or event) → table of conversions and conversion rate (sessions with
   the goal / all sessions) for the selected range.
4. **Bunny — AI analyst** (`/sites/[id]/ask`): a question box with 6 suggested questions; `POST
   /api/sites/[id]/ask` returns `{answer_md, sql, rows, columns, chart, mode}`. UI shows the answer, a
   collapsible **"Query Bunny ran"** block with the SQL (always visible by default, like the original),
   a results table (max 50 rows), and a chart when `chart` is set (`{type:'line'|'bar', x, y}`). History
   of previous questions for the site below (from `questions` table). LLM pipeline (real mode):
   - System prompt: role, the exact schema (columns + meaning), the site_id to filter on, the current
     date/time in UTC, rules (SELECT only, always filter `site_id = ?` via the provided parameter, use
     `date(ts)` / `strftime` for grouping, LIMIT ≤ 200, no PII, prefer per-day series), and the required
     final JSON answer shape. Tool `run_sql({ sql: string, purpose: string })` executes through the guard and
     returns `{columns, rows, rowCount, truncated}` (or `{error}`); allow up to 4 tool steps. The final
     message must be JSON matching `AnalystAnswer = { answer_md, chart?: {type, x, y, title?} }`; parse
     with zod, retry once on parse failure, else fall back to a plain-text answer. The `sql`/`rows`
     recorded are from the LAST successful `run_sql` call.
   - **SQL guard** (`src/lib/sql-guard.ts`, unit-tested): strip comments; exactly one statement; must
     start with `SELECT` or `WITH`; reject any of `INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|
     PRAGMA|REPLACE|VACUUM|REINDEX|TRIGGER|load_extension|sqlite_master|randomblob|readfile|writefile`
     as whole words (case-insensitive); only the tables `events`, `sites`, `funnels`, `goals` may be
     referenced; append `LIMIT 200` when no LIMIT present; run on the read-only connection with a 2 s
     busy timeout; the site filter is enforced by wrapping: `SELECT * FROM (<query>) ` is NOT enough, so
     instead require the query text to contain `site_id = :site` (or `site_id = @site` / `= ?`) and bind
     the site id; reject queries without a site filter with a clear error the model (or mock) can fix.
5. **Monitor & insights** (`/sites/[id]/insights`): "Run check now" → `POST /api/sites/[id]/monitor`
   computes, for the last 7 full days vs the 7 before: visitors, pageviews, sessions, bounce rate, error
   count, each goal's conversions, and the top-10 pages and referrers with the biggest absolute change.
   A change is "meaningful" if |Δ%| ≥ 20 and the absolute base is ≥ 20 (configurable thresholds). The
   digest (LLM in real mode, template in mock) is Markdown: headline, 3–6 bullets of changes with numbers,
   2–3 suggested next steps. Stored in `insights`; if `SLACK_WEBHOOK_URL` is set, POST `{text}` to it and
   record `sent_to_slack`. Page lists past insights newest first. Also expose `GET /api/cron/monitor?
   token=CRON_SECRET` that runs the check for every site (for an external scheduler).

## Tracker (`public/track.js`) requirements
- Reads `data-site` from its own script tag and `data-endpoint` (default: same origin as the script).
- Sends pageview on load and on SPA navigations (patch `history.pushState` / `replaceState`, listen to
  `popstate`); de-duplicates identical consecutive paths.
- Payload: `{site, type, name, path, referrer, screen_w, props, value, utm:{source,medium,campaign}}`
  (UTM parsed from `location.search`). Uses `navigator.sendBeacon` with `fetch(..., {keepalive:true})`
  fallback. `window.hutch = { track(name, props) }`.
- `window.addEventListener('error')` and `unhandledrejection` → `type:'error'` with `name` = message
  (truncated to 200 chars) and `props.stack` first 500 chars.
- Web Vitals: LCP via `PerformanceObserver('largest-contentful-paint')` → `type:'vital', name:'LCP',
  value` sent once on `visibilitychange`→hidden or `pagehide`. (CLS/INP optional; skip if time is short.)
- Respects `navigator.doNotTrack === '1'` → no events. No cookies, no localStorage, no fingerprinting
  beyond what the server derives from IP + UA for the daily-rotating visitor id.

## Endpoints
- `POST /api/collect` — CORS `*`, accepts a single event or an array (max 25), validates with zod,
  derives `visitor_id`/`session_id`/`referrer_host`/`browser`/`os`/`device`/`country` server-side,
  inserts, returns 202 `{ok:true, n}`. `OPTIONS` handled. Reject unknown `site`.
- `GET /track.js` — static file.
- `GET/POST /api/sites`, `GET/DELETE /api/sites/[id]`
- `GET /api/sites/[id]/stats?range=24h|7d|30d` — all dashboard aggregates in one JSON.
- `GET /api/sites/[id]/realtime` — `{visitors, pageviews}` in the last 5 min + the last 10 events.
- `GET/POST /api/sites/[id]/funnels`, `DELETE /api/sites/[id]/funnels/[fid]`, `GET /api/sites/[id]/funnels/[fid]/results?range=`
- `GET/POST /api/sites/[id]/goals`, `DELETE /api/sites/[id]/goals/[gid]`
- `POST /api/sites/[id]/ask` `{question}` → analyst answer (see flow 4); `GET` → history.
- `POST /api/sites/[id]/monitor` → runs the check; `GET /api/sites/[id]/insights` → list.
- `GET /api/cron/monitor?token=` → runs for all sites.
- `GET /api/health` → `{ok:true, mock:boolean, model}`.

## Screens
`/` (sites list + create form + mock banner), `/sites/[id]` (dashboard), `/sites/[id]/setup`,
`/sites/[id]/funnels`, `/sites/[id]/ask`, `/sites/[id]/insights`, `/demo-page` (a static marketing-style
page that loads `/track.js` for the demo site with buttons: "Sign up" → `hutch.track('signup')`,
"Go to /pricing" (SPA path change via pushState), "Throw a JS error"). A shared site nav with the tabs.

## Seed & scripts
- `npm run seed` (`scripts/seed.ts` via `tsx`, or a `.mjs` using the compiled db module): creates the demo
  site `demo` ("Hutch demo site", `demo.example.com`) if missing and inserts ~30 days of synthetic data:
  ~150–400 sessions/day with weekday/weekend seasonality, 1–6 pageviews per session over 12 paths, referrer
  mix (google, twitter/x, github, producthunt, direct, newsletter with utm), countries, browsers, devices,
  ~3% of sessions firing `signup`, ~1% `purchase` with `value`, ~1% of sessions producing a JS error from a
  list of 4 error messages, LCP vitals, plus one deliberate anomaly: the last 7 days have ~40% more
  `producthunt` referrals and the `/pricing` page gets 2× traffic (so the monitor finds something). Also
  creates one funnel (`/` → `/pricing` → `signup`) and two goals (`signup` event, `/pricing` path).
  Idempotent (skips if the demo site already has events). Keep it fast (< 15 s, use a transaction).
- `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`.
- On first start, if the DB has no sites, the home page shows a "Seed demo data" button that calls
  `POST /api/seed` (same logic as the script).

## Environment variables (`.env.example`)
```
# Optional. When absent the app runs in mock mode (rule-based analyst, templated digest).
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5-5
# Secret used to salt the daily-rotating visitor id. Any random string.
SALT_SECRET=change-me
# Optional Slack incoming webhook for monitor digests.
SLACK_WEBHOOK_URL=
# Optional shared secret for GET /api/cron/monitor
CRON_SECRET=change-me
# Where the SQLite file lives (default ./data/hutch.db)
DATABASE_PATH=./data/hutch.db
```

## Acceptance checks (all must pass; keep the exact commands and outputs)
1. `npm install && npm run build` succeed; `npm run lint` clean; `npm test` passes with tests for:
   `sql-guard` (accepts a valid SELECT with site filter; appends LIMIT; rejects INSERT/DROP/PRAGMA/ATTACH,
   multi-statement, missing site filter, unknown table, `sqlite_master`), `ua` parsing (4 UAs), session
   bucketing (two events 10 min apart share a session; 40 min apart do not), funnel computation on a tiny
   fixture (ordered steps, out-of-order step 2 before step 1 does not count), monitor change detection
   (threshold logic), and the mock analyst (3 sample questions produce guarded SQL that executes).
2. `npm run seed` then `npm start`: `GET /api/health` → 200 `{ok:true, mock:true}`;
   `GET /api/sites/demo/stats?range=30d` → visitors > 1000, pageviews > visitors, `topPages` has `/pricing`.
3. `curl -X POST localhost:3000/api/collect -H 'content-type: application/json' -H 'user-agent: Mozilla/5.0 (Macintosh) Chrome/130' -d '{"site":"demo","type":"pageview","path":"/accept-test","referrer":"https://news.ycombinator.com/"}'`
   → 202; then `GET /api/sites/demo/realtime` lists `/accept-test` and `GET .../stats?range=24h` shows
   referrer host `news.ycombinator.com`.
4. `POST /api/sites/demo/ask {"question":"What were my top 5 pages last week?"}` → 200 with non-empty
   `sql` starting with SELECT, `rows.length` between 1 and 5, `mode:"mock"`, and `answer_md` non-empty.
   `POST ... {"question":"Which referrers brought the most signups in the last 30 days?"}` → rows with a
   referrer column. A direct `POST` of a question whose mock template would contain `DROP` is impossible;
   instead the unit test proves the guard rejects it.
5. `GET /api/sites/demo/funnels` lists the seeded funnel; its results show 3 steps with
   non-increasing counts and overall conversion between 0 and 100%.
6. `POST /api/sites/demo/monitor` → 200 with `changes.length ≥ 1` (the producthunt/pricing anomaly) and a
   Markdown digest; `GET /api/sites/demo/insights` lists it.
7. Headless Chromium (Playwright is pre-installed; `require('playwright')` works from any directory, do not
   run `playwright install`): open `/demo-page`, click "Sign up", click "Go to /pricing", click "Throw a JS
   error"; wait 1.5 s; then `GET /api/sites/demo/realtime` shows a `signup` event, a `/pricing` pageview and
   an `error` event; open `/sites/demo` and assert the page has no console errors and renders at least one
   `svg` (recharts) and the stat tiles; open `/sites/demo/ask`, type a question, submit, assert the SQL
   block appears. Write this as `scripts/e2e.mjs` and include its output in the report.
