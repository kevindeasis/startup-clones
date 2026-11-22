# PostSale — an independent clone of Quivly AI

> **Independent learning clone. Not affiliated with, endorsed by, or connected to Quivly AI or Y Combinator.**
> All data in this repo is fictional. Built as part of the daily `startup-clones` series (2026-11-22).

## What the original does

[Quivly AI](https://www.quivly.ai) (YC F26, [YC page](https://www.ycombinator.com/companies/quivly-ai)) sells "AI agents that run onboarding, adoption, and renewals" — an AI workforce for post-sales teams at usage-based B2B software companies, where founders, forward-deployed engineers and CSMs each juggle 15+ accounts. Its agents turn kickoff calls into staffed onboarding projects, score account health from usage, tickets and billing, detect usage drops and recommend save-plays in an actions feed, watch external signals (funding, acquisitions, hiring) for expansion, assemble renewal briefs, and answer questions from a Customer 360. It lives in Slack, its own app and an MCP server and integrates with CRMs, warehouses and billing.

## What this clone does

PostSale reproduces that product layer end to end on **seeded, fictional data** (no CRM, Slack or warehouse integrations):

1. **Portfolio and Customer 360** (`/`, `/accounts/[id]`): sortable account table with health band, 4-week trend and open actions; per-account usage chart (drop highlighted), health breakdown with the input numbers, projects, signals, timeline.
2. **Kickoff to onboarding project**: paste or upload a transcript, get goals, tasks (vendor/customer owner, due date, blocker flag), blockers, stakeholders, risks and a Slack-ready recap (stored as a `slack-draft` note). Tasks have checkboxes.
3. **Health, usage-drop detection and the Actions Feed** (`/actions`): deterministic health score and rules (below); Accept (creates a project with template tasks), Snooze 7d, Dismiss; CSV/JSON usage ingest re-analyzes the account.
4. **Radar** (`/radar`): fictional articles (and a paste form) are classified, tagged to accounts, and turned into expansion/risk actions.
5. **Renewal brief and Ask**: one click drafts a six-section renewal brief with a rule-based renewal ask; "Ask" answers questions with `[n]` citations retrieved by MiniSearch.

**Skipped** (as in the spec): auth, billing, multi-tenant orgs, real Slack/CRM/warehouse/Gong integrations, MCP server, email sending, schedulers, admin UI.

## Architecture

```
src/app/                 Next.js 16 App Router: server-component pages + route handlers under api/
src/components/          ui.tsx (SVG charts, badges, markdown), client.tsx (forms/buttons), ActionCard.tsx
src/lib/store.ts         JSON file store (data/db.json) with an in-process mutex, atomic writes
src/lib/health.ts        health score + usage statistics (pure, unit-tested)
src/lib/analyze.ts       rule engine (usage drop, renewal, onboarding, billing, quota) + dedupe + persistence
src/lib/llm.ts           the only module that talks to a model: planKickoff, classifySignal, explainAction,
                         draftRenewalBrief, answerQuestion; 30 s timeout and mock fallback (degraded:true)
src/lib/mock.ts          deterministic rule-based implementations used offline and as fallback
src/lib/prompts.ts       prompts; schemas.ts holds zod v4 schemas for LLM output and request bodies
src/lib/ask.ts           per-account MiniSearch index and cited answers
scripts/                 seed.ts, analyze.ts, smoke.mjs
data/seed/               accounts, 12 weeks of usage CSV per account, tickets, invoices, notes, transcript, radar articles
tests/lib.test.ts        vitest unit tests (18)
```

Numbers always come from code; the LLM only phrases them.

### Health score (0-100, `src/lib/health.ts`)

`score = 0.30 usageTrend + 0.20 adoptionBreadth + 0.15 supportLoad + 0.15 billing + 0.20 engagementRecency`

| Sub-score | Formula |
|---|---|
| usageTrend | `clamp(85 + (ratio - 1) * 150)`, ratio = mean metered units of the last 2 complete weeks / mean of the prior 4 weeks |
| adoptionBreadth | `clamp(avg active users (last 2 wks) / seats / 0.70 * 100)` (70 % of seats active = 100) |
| supportLoad | `clamp(100 - 5 * tickets opened in last 4 wks - 8 * currently open tickets)` |
| billing | `clamp(100 - 5 * open-not-due invoices - (30 + min(days overdue, 40)) * overdue invoices)`; no invoices = 80 |
| engagementRecency | 100 if the last call/email/note was <= 14 days ago, then falls linearly to 0 at 90 days (Slack drafts do not count) |

Bands: **green >= 75**, **amber 50-74**, **red < 50**. Each analyze run stores a `HealthSnapshot`; the seed back-fills five weekly points.

### Action rules (`src/lib/analyze.ts`, run by `npm run analyze`, `POST /api/analyze`, after seed and after usage ingest)

| Type | Fires when | Priority / play |
|---|---|---|
| `usage_drop` | mean of last 2 complete weeks is >= `USAGE_DROP_THRESHOLD_PCT` (25) % below the mean of the prior 4 weeks | high if drop >= 40 %, else medium. Play: `adoption_workshop` if seat breadth fell >= 15 % (relative), else `check_in` if weekly tickets rose (>= 1.5x and +1), else `win_back` if drop >= 60 %, else `check_in` |
| `renewal_prep` | 0-90 days to renewal and no renewal brief exists | high if <= 30 days |
| `onboarding_stalled` | an active onboarding project has a not-done blocker task overdue >= 7 days | high, play `unblock` |
| `billing_risk` | an unpaid invoice is >= 14 days past due | high if >= 30 days, play `collections` |
| `expansion` | usage >= 90 % of plan quota in 3 of the last 4 weeks, **or** a relevant Radar expansion signal | medium |
| `risk` | a relevant Radar risk signal (layoffs, outage) | high |

Idempotent: an action is skipped if the same dedupe key exists, or an open / actively snoozed action of the same type exists for the account. Each action gets a 2-sentence `rationale` citing the real numbers and 3 `nextSteps` from `explainAction`.

### Renewal ask rule (`renewalAsk` in `src/lib/context.ts`)

Health < 50: flat ARR, 12 months, success plan. Else quota >= 90 %: +15 %, 24 months. Else health >= 75: +5 %, 24 months. Else flat 12 months. The justification string is generated from the numbers.

## Open-source tools used

- [Next.js](https://github.com/vercel/next.js) 16 (App Router) + [React](https://github.com/facebook/react) 19 + TypeScript
- [Vercel AI SDK](https://github.com/vercel/ai) (`ai` 7) and [`@ai-sdk/anthropic`](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) 4 for the live path (`generateText` + `Output.object`; `generateObject` is deprecated in this version)
- [zod](https://github.com/colinhacks/zod) 4 for schemas and request validation
- [MiniSearch](https://github.com/lucaong/minisearch) 7 for per-account retrieval
- [vitest](https://github.com/vitest-dev/vitest) 5 for tests, [tsx](https://github.com/privatenumber/tsx) for scripts, [ESLint](https://github.com/eslint/eslint) with `eslint-config-next`

## Setup and run

Requires Node 22 and npm. No Docker, no database, no API key.

```bash
npm install
cp .env.example .env        # optional; everything works without it
npm run seed                # creates data/db.json (idempotent), runs analyze
npm run dev                 # http://localhost:3000   (or: npm run build && PORT=3111 npm run start)
```

Other scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run analyze [accountId]`, and `npm run smoke` (needs a running server; set `PORT` or `BASE_URL`). The smoke script **re-seeds the database first** (set `SMOKE_NO_RESEED=1` to skip) and then checks 17 end-to-end steps, printing PASS/FAIL for each and exiting non-zero on failure.

Seed dates are shifted by whole weeks so the 12 weeks of usage always end at the last complete week; re-run `npm run seed` after a few weeks to refresh the demo.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | When set (and `LLM_MODE` is not `mock`) the app runs in live mode |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for all calls |
| `ANTHROPIC_CLASSIFY_MODEL` | `ANTHROPIC_MODEL` | Optional cheaper model for Radar classification and action rationales (e.g. `claude-haiku-5-5`) |
| `LLM_MODE` | empty | `mock` forces mock mode even with a key |
| `USAGE_DROP_THRESHOLD_PCT` | `25` | Usage-drop detector threshold |
| `DATA_DIR` | `./data` | Where `db.json` lives (seed inputs stay in `data/seed`) |
| `PORT` | `3000` | Port for `next start` / `next dev` / smoke |

## Mock vs live mode

`mode()` in `src/lib/llm.ts` returns `live` only if `ANTHROPIC_API_KEY` is set and `LLM_MODE !== "mock"`. Every API response carries `mode`, and the nav shows a `mock`/`live` badge.

- **Mock**: deterministic, rule-based (`src/lib/mock.ts`): kickoff parsing from speaker labels and trigger words (`will`, `need to`, `TODO`, `SSO`, `by Friday`...), keyword-based signal classification with name/alias/domain tagging, and templates that interpolate the real numbers and sources.
- **Live**: structured calls via `generateText({ output: Output.object({ schema }) })` with zod schemas and the prompts in `src/lib/prompts.ts` ("use only the provided data, never invent numbers, output JSON per schema"). Each call has a 30 s timeout; on any error (or a brief missing a required heading) the mock output is returned flagged `degraded: true`.

**The live path is type-checked and built against the installed `ai` package, but it has not been exercised against the real Anthropic API** (no key was available when this was built).

## Known limitations

- Single-process JSON file store: fine for a demo, not for concurrent writers or large data.
- The mock kickoff parser is heuristic: it works well on `Name (Company, Role): text` transcripts and will produce noisy tasks on free-form text; task titles are the original sentences.
- The mock "Ask" is retrieval plus templated excerpts, not reasoning. Only the latest renewal brief is rendered on the account page (so only its citations can be scrolled to).
- Expansion from Radar is simplistic: any "acquisition" of or by a tracked account is treated as expansion.
- No auth; all API routes are open. No pagination. Seed usage is one row per week; "complete week" assumes Monday week starts.
- Visual QA was limited to CSS written for 390 px (tables scroll inside their card; no page-level horizontal scroll); no browser screenshots were taken.

## Next 3 things to build

1. Real connectors: a Slack bot that posts the kickoff recap and delivers Actions Feed items, and a warehouse/billing sync (Postgres or Stripe usage) in place of CSV ingest.
2. An MCP server exposing `get_account`, `list_actions` and `ask` so agents in other tools can use the Customer 360.
3. Evaluate and harden the live prompts: a small eval set of transcripts and articles with expected outputs, run against Sonnet and Haiku, plus a SQLite store replacing the JSON file.
