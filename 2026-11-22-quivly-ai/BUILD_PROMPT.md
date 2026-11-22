# BUILD_PROMPT.md — 2026-11-22 Quivly AI clone ("PostSale")

Verbatim prompt sent to the Sonnet build subagent (Agent tool, subagent_type general-purpose, model "sonnet"). Follow-up fix prompts, if any, are appended below in order.

## Round 1 — initial build prompt

```
You are building a working end-to-end clone of the YC F26 startup Quivly AI, called "PostSale", inside the folder `/home/user/startup-clones/2026-11-22-quivly-ai/` (the folder already exists and contains SPEC.md, BUILD_PROMPT.md and BUILD_LOG.md — do not modify those three files). Build exactly per the spec below. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them.

Rules:
- Build the working end-to-end clone inside `/home/user/startup-clones/2026-11-22-quivly-ai/` exactly per the spec. Use Next.js 16 (App Router, TypeScript, React 19), the Vercel AI SDK (`ai` ^7 + `@ai-sdk/anthropic` ^4), zod 4, MiniSearch, vitest and tsx as the spec says. Scaffold with `npm create next-app@latest` flags (`--ts --app --src-dir --eslint --no-tailwind --import-alias "@/*" --use-npm --yes`) or by hand; either is fine as long as `npm run dev/build/start/lint/typecheck/test/seed/analyze/smoke` all exist in package.json.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO `ANTHROPIC_API_KEY` in this sandbox: the app must run fully in mock mode, and the live path must type-check and be written against the actually installed `ai` package API (read `node_modules/ai/dist/index.d.ts` to confirm whether `generateObject` or `generateText` + `Output.object` exists; do not guess).
- Add a `.gitignore` appropriate for the stack (node_modules, .next, out, .env and .env.*, but keep .env.example, data/db.json, *.log, coverage, .DS_Store).
- Verify it: install dependencies, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run seed`, then start the app (`npm run start` on a free port, e.g. PORT=3111) in the background and run `npm run smoke` against it to confirm it boots and the main flows work in mock mode. Also curl each page for HTTP 200. Fix errors before finishing. Do not claim it works unless you actually ran it. Stop any background server when done (kill the process).
- Write a thorough `README.md` in the folder: what the original company does (with link to https://www.quivly.ai and https://www.ycombinator.com/companies/quivly-ai), what this clone does and what it skips, architecture summary (with the health-score formula and the action rules), the GitHub/open-source tools used (with links), exact setup and run steps, environment variables, mock vs live mode, known limitations, and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Quivly AI.
- Do not modify anything outside `/home/user/startup-clones/2026-11-22-quivly-ai/`. Do not commit or push. Do not create files in other folders of the repo.
- All seed data must be fictional (invented company names, people, numbers). Do not use real company names in seed data.
- Keep the code reasonably small and readable; prefer one global stylesheet over a CSS framework. Pages must be readable at 390 px wide (no horizontal scroll).
- When finished, report back: what was built (file tree summary), exactly which verification commands you ran and their results (copy the smoke output), anything that does not work or deviates from the spec, and your total input/output token usage as best you can tell.

Here is the full SPEC.md:

---
# SPEC — Quivly AI clone ("PostSale") — 2026-11-22

Independent learning clone of **Quivly AI** (YC F26, https://www.quivly.ai, YC page
https://www.ycombinator.com/companies/quivly-ai): "AI agents that run onboarding, adoption, and
renewals" — "The AI workforce for post-sales teams." Not affiliated with Quivly.

## What the product does
Quivly is an AI workspace for everything after a B2B deal closes, aimed at usage-based software
companies whose founders, forward-deployed engineers and CSMs each juggle 15+ accounts. Its agents:
- turn a **kickoff call** (transcript + email + Slack) into a staffed **onboarding project**: tasks
  with owners on both sides, blockers (e.g. "SSO and SCIM ownership unresolved") tracked as tasks,
  and a kickoff recap posted to Slack;
- compute a **health score** per account from product usage, tickets and billing, detect a **drop in
  weekly usage** and recommend a **save-play** (adoption workshop, check-in, win-back project) in an
  **Actions Feed**;
- watch external **Radar** signals (the customer raised money, acquired a company, is hiring) and turn
  them into **expansion** suggestions (open an expansion project, draft a note to the champion);
- at renewal, assemble the year's history into a **renewal brief** (health trend, usage recovery,
  expansion paths, the renewal ask);
- answer questions about any account ("Ask Quivly") from a **Customer 360** context.
Quivly sells into Slack, its app and an MCP server and integrates with CRMs, warehouses and billing.

The clone, **PostSale**, reproduces that product layer end to end on **seeded, fictional data**
(no CRM/Slack/warehouse integrations): usage events + tickets + invoices in → health scores, usage-drop
detection and an actions feed; a pasted kickoff transcript → onboarding project with tasks and recap;
pasted/seeded news → Radar expansion signals; one click → renewal brief; chat → cited account answers.

## Core user flows (implement all five)
1. **Portfolio and Customer 360** — `/` is the portfolio: a table of accounts (name, plan, ARR, days to
   renewal, health score with colour band ≥75 green / 50–74 amber / <50 red, 4-week usage trend
   sparkline or ▲/▼ %, open actions count, owner). Sort by health, renewal date, ARR. `/accounts/[id]`
   is the Customer 360: header (name, segment, plan, ARR, contract start/renewal dates, champion,
   owner, health score + band + one-line "why" explanation), a **Usage** section (weekly active users
   and weekly API calls / metered units for the last 12 weeks as a small inline SVG bar/line chart with
   the detected drop highlighted), **Health breakdown** (usage trend, adoption breadth, support load,
   billing status, engagement recency — each a sub-score with its input numbers), **Open actions**
   for this account, **Projects** (onboarding / save-play / expansion with task lists), **Signals**
   (Radar items tagged to this account), **Timeline** (notes, calls, tickets, invoices, signals, newest
   first) and the **Ask** box (flow 5).
2. **Kickoff → onboarding project** — on the Customer 360 (and `/projects/new`), paste a kickoff
   call transcript (textarea; `.txt`/`.md` upload also accepted) and click "Create onboarding
   project". The **kickoff pipeline** returns a structured plan: `goals[]` (what success looks like
   for the customer, with target dates if mentioned), `tasks[]` (title, owner side `vendor | customer`,
   owner name if mentioned, due in N days, `isBlocker`), `blockers[]` (short description + which task),
   `stakeholders[]` (name, role, side), `risks[]`, and a `recap` (≤ 150 words, written as a Slack-ready
   message starting with "Kickoff recap — {account}"). The result is saved as a `Project` of kind
   `onboarding` with `Task` rows; the UI shows the plan with checkboxes to mark tasks done, blocker
   badges, and a "Copy recap" button (the recap is also stored as a Note on the timeline, tagged
   `slack-draft`, which stands in for "posted to Slack"). Each seeded account that is in onboarding
   ships with a bundled fictional transcript under `data/seed/transcripts/` and `npm run seed`
   runs the pipeline on it so the demo has projects without any paste.
3. **Health, usage-drop detection and the Actions Feed** — `/actions` lists every open `Action`
   across accounts, newest/highest priority first, with filters (type, priority, account) and
   buttons **Accept** (creates the recommended Project with its template tasks, marks the action
   `accepted`), **Snooze 7d**, **Dismiss**. Actions are produced by `npm run analyze` (and
   `POST /api/analyze`, also run automatically after seed and after ingesting usage data):
   - **Health score** (deterministic code, not LLM): 0–100 = weighted sum of five sub-scores
     (usage trend 30 %, adoption breadth 20 %, support load 15 %, billing 15 %, engagement recency
     20 %), each computed from the stored events with documented formulas in `src/lib/health.ts`.
   - **Usage-drop detector**: compare the mean of the last 2 complete weeks' metered usage with the
     mean of the prior 4 weeks; if the decline is ≥ 25 % (`USAGE_DROP_THRESHOLD_PCT`, default 25)
     create an action of type `usage_drop` with `priority` high (≥ 40 %) or medium, and the
     recommended play: `adoption_workshop` if breadth (active seats / licensed seats) also fell,
     `check_in` if usage fell but tickets rose, else `win_back` when the drop is ≥ 60 %.
   - **Other rules**: `renewal_prep` when days-to-renewal ≤ 90 and no renewal brief exists;
     `onboarding_stalled` when an onboarding project has a blocker task overdue ≥ 7 days;
     `billing_risk` when an invoice is overdue ≥ 14 days; `expansion` from Radar (flow 4) or when
     usage is ≥ 90 % of the plan quota for 3 of the last 4 weeks.
   - Each action gets an LLM-written (mock-able) `rationale` (2 sentences citing the actual numbers)
     and `nextSteps[]` (3 bullets), produced by `explainAction(action, accountContext)`. Numbers come
     from code; the LLM only phrases them. Idempotent: re-running analyze does not duplicate open
     actions of the same type for the same account.
   - **Ingest usage**: `POST /api/accounts/[id]/usage` accepts CSV (`week_start,active_users,
     metered_units,tickets_opened`) or JSON rows; the Customer 360 has an upload box. After ingest,
     analyze runs for that account and the page re-renders with the new score and any new action.
4. **Radar (expansion and risk signals)** — `/radar`: a feed of external signals. Items enter via
   (a) `POST /api/radar` with `{ title, text, source, url?, publishedAt? }` (paste form on the page),
   (b) `npm run seed` (≈ 10 bundled fictional articles: a customer acquires a company, one raises a
   Series B, one announces layoffs, one hires a new CTO, one posts 12 engineering roles, one is
   irrelevant local news, etc.). The **radar pipeline** returns `relevant` (bool), `accountIds[]`
   (tag against seeded account names/aliases/domains), `signalType`
   (`acquisition | funding | leadership_change | hiring | layoffs | outage | competitor | other`),
   `direction` (`expansion | risk | neutral`), `summary` (2 sentences) and `suggestedPlay`
   (`expansion_project | champion_note | exec_check_in | none`). Relevant expansion signals create an
   `expansion` Action; risk signals create a `risk` Action. Signals appear on the tagged account's
   Customer 360. The feed filters by direction/type/account and can show filtered-out items.
5. **Renewal brief and Ask** — on the Customer 360, "Draft renewal brief" calls
   `POST /api/accounts/[id]/renewal-brief`, which builds the brief from the account's full context
   (health history, usage series summary, open actions, projects and task completion, signals, tickets,
   invoices, notes) via the LLM (mock-able) and stores it as a `Brief` (markdown) shown on the page
   with sections **Health trend**, **Usage story**, **Open risks**, **Expansion paths**, **Renewal ask**
   (recommended ARR and term with a one-line justification computed from the numbers: e.g. propose
   uplift when usage ≥ 90 % quota, flat with a success plan when health < 50) and **Talking points**.
   **Ask**: the Ask box on the Customer 360 and `/ask` (choose an account) answers a question from the
   account's context. Retrieval: all timeline items, tasks, signals, briefs and a generated
   "metrics card" are indexed per account in MiniSearch; top-8 chunks become numbered sources
   `[1]..[n]`; the LLM answers in ≤ 150 words citing `[n]`; response returns
   `{ answer, citations: [{ n, kind, id, title, excerpt }] }` and the UI renders clickable citation
   chips. Mock mode: templated answer listing the top-3 sources with excerpts.

## LLM pipeline design (live vs mock)
- One module `src/lib/llm.ts` exposes `planKickoff(transcript, account)`, `classifySignal(item,
  accounts)`, `explainAction(action, ctx)`, `draftRenewalBrief(ctx)` and `answerQuestion(question,
  sources, account)`. `mode()` returns `"live"` when `ANTHROPIC_API_KEY` is set and
  `LLM_MODE !== "mock"`, else `"mock"`. Every API response and the UI header show a `mock`/`live` badge.
- Live: Vercel AI SDK `ai` v7 with `@ai-sdk/anthropic` v4, model from `ANTHROPIC_MODEL`
  (default `claude-sonnet-5-5`; `claude-haiku-5-5` is a cheaper option for classification).
  Structured outputs use zod v4 schemas. Check the installed version's API (`generateObject` vs
  `generateText` + `Output.object`) by reading `node_modules/ai/dist/index.d.ts`; use whichever
  exists, do not guess. Keep prompts in `src/lib/prompts.ts`. Every prompt states: use only the
  provided data, never invent numbers, output JSON per schema.
- Mock (`src/lib/mock.ts`): deterministic and rule-based so the whole app is exercisable offline:
  - kickoff: parse the transcript for lines containing `TODO`, `action item`, `will`, `need to`,
    `blocker`, `blocked`, `SSO`, `SCIM`, `by <weekday|date>`, speaker labels (`Name (Company):`) to
    derive stakeholders/tasks/blockers; the recap is a template filled with counts and the first
    three goals. Must produce ≥ 3 tasks and ≥ 1 blocker on the bundled transcripts.
  - signal classification: keyword rules (`acquire|acquisition` → acquisition/expansion,
    `raises|Series|funding` → funding/expansion, `layoff|cuts` → layoffs/risk, `CTO|CEO|appoint`
    → leadership_change/neutral, `hiring|open roles` → hiring/expansion, `outage` → outage/risk);
    account tagging by name/alias/domain match; unmatched → `relevant:false`.
  - action rationale / brief / answer: templates that interpolate the real numbers and sources.
- All LLM calls are wrapped with a 30 s timeout and fall back to mock output (flagged
  `degraded:true`) on error, so the UI never hangs.

## Stack
- **Next.js 16 (App Router) + TypeScript + React 19**, `npm create next-app` style layout under
  `src/app`. Server components for pages, route handlers under `src/app/api/**`. Plain CSS modules
  or a single global stylesheet (no Tailwind needed); must be readable at 390 px wide.
- **Vercel AI SDK** `ai` ^7.0.179 + `@ai-sdk/anthropic` ^4.0.107 (verified on npm 2026-11-22) for
  LLM calls; **zod** ^4.6.7 for schemas and request validation.
- **MiniSearch** ^7.2.0 for per-account retrieval in Ask.
- **Persistence**: a single JSON file store `data/db.json` behind `src/lib/store.ts` (read/write
  with an in-process mutex; typed collections). No external DB. `data/db.json` is gitignored;
  `npm run seed` recreates it from `data/seed/*` (committed: accounts JSON, 12 weeks of weekly usage
  rows per account as CSV, tickets, invoices, notes, transcripts, radar articles).
- **vitest** ^5.1.1 for unit tests (health formulas, usage-drop detector, mock kickoff parser,
  signal classifier/tagger, renewal-ask rule). **tsx** for scripts. `scripts/smoke.mjs` hits the
  running server end to end.
- Node 22. No Docker.

## Data model (TypeScript types in `src/lib/types.ts`)
- `Account { id, name, aliases[], domain, segment, plan, arr, seats, quotaUnitsPerWeek,
  contractStart, renewalDate, owner, champion { name, title, email }, stage: 'onboarding'|'active'|
  'renewal'|'churned', health?: { score, band, parts: {usageTrend, adoptionBreadth, supportLoad,
  billing, engagementRecency}, computedAt, why } }`
- `UsageWeek { accountId, weekStart (ISO date, Monday), activeUsers, meteredUnits, ticketsOpened }`
- `Ticket { id, accountId, openedAt, closedAt?, priority, subject }`
- `Invoice { id, accountId, issuedAt, dueAt, paidAt?, amount, status: 'paid'|'open'|'overdue' }`
- `Note { id, accountId, at, kind: 'note'|'call'|'email'|'slack-draft', title, body }`
- `Project { id, accountId, kind: 'onboarding'|'save_play'|'expansion', title, status, createdAt,
  goals[], stakeholders[], risks[], recap?, sourceNoteId? }`
- `Task { id, projectId, accountId, title, ownerSide, ownerName?, dueAt, isBlocker, done }`
- `Signal { id, title, text, source, url?, publishedAt, relevant, accountIds[], signalType,
  direction, summary, suggestedPlay, createdAt }`
- `Action { id, accountId, type: 'usage_drop'|'renewal_prep'|'onboarding_stalled'|'billing_risk'|
  'expansion'|'risk', priority: 'high'|'medium'|'low', title, play, evidence: Record<string,number|
  string>, rationale, nextSteps[], status: 'open'|'accepted'|'snoozed'|'dismissed', snoozedUntil?,
  createdAt, projectId? }`
- `Brief { id, accountId, createdAt, markdown, ask: { proposedArr, termMonths, justification } }`
- `HealthSnapshot { accountId, at, score }` (one per analyze run, for the trend)

## Screens / endpoints
Pages: `/` portfolio · `/accounts/[id]` Customer 360 · `/actions` · `/radar` · `/projects/new` ·
`/ask`. A top nav with the mode badge.
API (all JSON, zod-validated, errors as `{ error }` with 4xx):
- `GET /api/health` → `{ ok, mode, counts }`
- `GET /api/accounts`, `GET /api/accounts/[id]` (full 360 payload)
- `POST /api/accounts/[id]/usage` (CSV text or JSON rows) → re-analyze → `{ ingested, health, newActions }`
- `POST /api/accounts/[id]/kickoff` `{ transcript }` → `{ project, tasks, recap }`
- `POST /api/accounts/[id]/renewal-brief` → `{ brief }`
- `POST /api/accounts/[id]/ask` `{ question }` → `{ answer, citations, mode }`
- `POST /api/analyze` `{ accountId? }` → `{ analyzed, newActions }`
- `GET /api/actions?status=open`, `POST /api/actions/[id]` `{ op: 'accept'|'snooze'|'dismiss' }`
- `GET /api/radar`, `POST /api/radar` (paste) → `{ signal, actions }`
- `PATCH /api/tasks/[id]` `{ done }`

## Seed data (fictional, written by the builder; ≈ 8 accounts)
Make them tell different stories so every rule fires at least once: (1) healthy, growing, near quota
→ expansion; (2) 45 % usage drop with breadth drop → adoption_workshop; (3) 30 % drop with ticket
spike → check_in; (4) 70 % drop → win_back; (5) onboarding with an overdue SSO/SCIM blocker →
onboarding_stalled; (6) renewal in 60 days, healthy → renewal_prep; (7) overdue invoice →
billing_risk; (8) steady mid account with no action (control). Account names must be invented
(no real companies). Radar articles reference accounts (1), (6) and two unknown companies.

## Environment variables (`.env.example`)
`ANTHROPIC_API_KEY=` (optional; absent → mock) · `ANTHROPIC_MODEL=claude-sonnet-5-5` ·
`LLM_MODE=` (`mock` forces mock) · `USAGE_DROP_THRESHOLD_PCT=25` · `DATA_DIR=./data` · `PORT=3000`.

## Skip
Auth, billing, multi-tenant orgs, real Slack/CRM/warehouse/Gong integrations, MCP server, email
sending, background schedulers (analyze is on-demand + after ingest), admin UI.

## Acceptance checks (the build must pass all; the main agent will re-run them)
1. `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (≥ 12 tests) and `npm run build` all
   succeed with no `ANTHROPIC_API_KEY` set.
2. `npm run seed` creates `data/db.json` with ≈ 8 accounts, 12 weeks of usage each, tickets, invoices,
   notes, ≥ 1 onboarding project with ≥ 3 tasks and ≥ 1 blocker created from a bundled transcript,
   ≈ 10 radar signals, and runs analyze so that **at least one open action of each type**
   (`usage_drop` ×3 with the three different plays, `renewal_prep`, `onboarding_stalled`,
   `billing_risk`, `expansion`) exists. Seed is idempotent (re-run → same counts, no duplicates).
3. `npm run start` boots on `PORT`; `GET /api/health` returns `mode:"mock"`; `/`, `/accounts/[id]`,
   `/actions`, `/radar`, `/ask` render with HTTP 200 and no server errors in the log.
4. `npm run smoke` (against the running server) checks, printing PASS/FAIL per step and exiting
   non-zero on any failure: health; portfolio has 8 accounts with health scores in 0–100 and the
   three bands present; the drop account's 360 shows a `usage_drop` action with the right play and a
   rationale containing the actual percentage; POST kickoff with a new transcript creates a project
   with ≥ 3 tasks and a recap starting with "Kickoff recap"; PATCH a task done persists; POST a
   usage CSV with a sharp drop for the control account creates a new `usage_drop` action and lowers
   its score; POST radar paste "X acquires Y" tagged to a seeded account creates an `expansion`
   action; irrelevant paste → `relevant:false`, no action; POST renewal-brief returns markdown with
   all six section headings and a numeric `proposedArr`; POST ask returns ≥ 2 citations whose ids
   resolve; accept an action creates a project; analyze twice → no duplicate open actions.
5. README documents setup, env vars, mock vs live, the health formula, the rules, limitations and
   next steps. `.gitignore` excludes `node_modules`, `.next`, `data/db.json`, `.env*` (keep
   `.env.example`).
```
