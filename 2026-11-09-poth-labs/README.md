# Poth Labs clone

> An independent learning clone. Not affiliated with, endorsed by, or connected to Poth Labs or Y Combinator.

## The original
[Poth Labs](https://pothlabs.com) (YC S26) is AI-native customer research. It takes a company's existing data (usage, support tickets, call notes), generates hypotheses about user behavior (churn, failed activation, checkout abandonment), validates them through adaptive AI interviews and surveys, and files the answers back on the customer account.

## What this clone does
1. **Import data**: paste or upload an accounts/usage CSV and plain-text support tickets or call notes. A "Load sample data" button seeds a 12-account SaaS churn study.
2. **Generate hypotheses**: for the research question, produces 3-5 ranked hypotheses, each with a rationale, cited evidence ids and a confidence score (0-1).
3. **Adaptive interview**: a public link `/i/[token]` opens a chat. The interviewer asks one open-ended question at a time, aimed at the most uncertain hypotheses, with follow-ups based on earlier answers. It ends after 5 respondent answers (`INTERVIEW_TURNS`) or when the interviewer returns `DONE`.
4. **Update hypotheses**: on finish, each hypothesis is scored supports / contradicts / neutral with a quote. Confidence changes by +0.1 / -0.15 / 0, clamped to 0.02-0.98. The respondent's answer summary is stored on the account (`attrs_json.interview_summary`).
5. **Dashboard** (`/p/[id]`): tabs Data, Hypotheses (ranked, evidence counts, quotes), Interviews (links, status), Accounts (data evidence + interview answers).

Skipped: auth, billing, real integrations (Zendesk, Salesforce, ...), voice interviews, email delivery of links.

## Architecture
- Next.js 16 App Router + TypeScript, plain CSS. Pages are client components that call the JSON API.
- `lib/db.ts`: better-sqlite3, schema auto-created (projects, accounts, evidence, hypotheses, interviews, messages, findings).
- `lib/importer.ts`: papaparse CSV import (account table, or usage events if an `event` column exists) and blank-line-separated text import (`[account_id] text` links an entry to an account).
- `lib/llm.ts`: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`). `generateObject` with zod schemas for hypotheses and scoring, `generateText` for interviewer turns.
- `lib/mock.ts`: deterministic mock LLM (keyword-derived hypotheses, scripted/adaptive interviewer, keyword scoring with negation). Automatic when `ANTHROPIC_API_KEY` is unset or `MOCK_LLM=1`.
- `lib/confidence.ts`: pure confidence-update function. `lib/service.ts`: business logic used by the route handlers.
- Tests: `tests/logic.test.ts` (vitest) covers confidence update, importer, mock LLM.

API: `GET/POST /api/projects` (`{sample:true}` loads sample data), `GET /api/projects/[id]`, `POST .../import` (`{csv,tickets,calls}`), `POST .../hypotheses`, `POST .../interviews` (`{accountId?}`), `GET /api/interview/[token]`, `POST /api/interview/[token]/message` (`{content}`), `POST /api/interview/[token]/finish`.

## GitHub tools used
None were needed to build the app (no GitHub MCP or `gh` calls; the work was local files plus npm). Open-source libraries: ai, @ai-sdk/anthropic, zod, better-sqlite3, papaparse, vitest, next.

## Setup and run
```bash
cd 2026-11-09-poth-labs
npm install
cp .env.example .env      # optional; leave the key empty for mock mode
npm run build && npm start   # or: npm run dev
npm test
```
Open http://localhost:3000, click "Load sample data", Hypotheses -> Generate, Interviews -> Create interview link, open the link and answer 5 questions (or "Finish now" after at least one answer), then return to the project.

Node 20+ is required (built on Node 22).

## Environment variables
| Name | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Unset means mock mode |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model override |
| `DATABASE_PATH` | `./data/poth.db` | SQLite file (gitignored) |
| `MOCK_LLM` | unset | `1` forces mock even with a key |
| `INTERVIEW_TURNS` | `5` | Respondent answers per interview |

## Known limitations
- Real-LLM path (Anthropic) is implemented but was not exercised (no API key available); only mock mode was run end to end.
- Mock mode is keyword-based and crude; it is for demos and tests only.
- Interview links are unauthenticated bearer tokens; no rate limiting; no auth anywhere.
- Regenerating hypotheses deletes existing hypotheses and findings.
- Only the first 60 evidence rows are sent to the LLM as the data sample.
- CSV import appends evidence on re-import (accounts are de-duplicated by external id).
- Respondent chat UI is minimal; no streaming.

## Next 3 things to build
1. Survey mode: send the same adaptive script as a short async survey, with per-account result rollups.
2. Real connectors (CSV upload to start, then Zendesk/Intercom ticket sync) and write-back of findings to the CRM account.
3. Better evidence handling: retrieval/embeddings over tickets instead of a fixed sample, and interview-time evidence that lets the interviewer reference the respondent's own tickets.
