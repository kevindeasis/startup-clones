# Permitly - a Verdant clone (2026-11-18)

> Independent learning clone. **Not affiliated with, endorsed by, or derived from the code of Verdant.** It is built from public descriptions only, for study.

## The original company
[Verdant](https://www.verdantapp.com) (YC S26) sells AI agents to local governments, starting with permitting. Residents chat with an agent trained on the city's code, a guided intake portal helps them file complete applications, AI completeness/plan review flags missing items and code conflicts with citations, and after a decision the system drafts staff reports and council memos. See the [YC launch post](https://www.ycombinator.com/launches/RHI-verdant-helping-cities-process-permits-faster).

## What this clone does
A single Next.js app for a fictional "City of Pinecrest":
1. **Permit discovery chat** (`/apply`) - streaming chat; answers cite code sections found by keyword search (MiniSearch) and recommend permit types with "Start application" buttons.
2. **Guided intake** (`/apply/[permitType]`) - form generated from each permit type's required fields, PDF/.txt attachments (PDF text via unpdf), a "Run pre-check" button and "Submit".
3. **Completeness and compliance review** (`/staff/[id]`) - deterministic rule engine (max/min/ratio/required field/required document) plus an LLM pass that adds explanation and extra `ai` checks. AI cannot change rule statuses.
4. **Staff report drafting** - Markdown report (Summary, Project Description, Site & Zoning, Analysis table, Public Notice, Recommendation, Conditions).
5. **Staff dashboard** (`/staff`) with status controls and a "Seed sample applications" button.

**Skipped:** auth, billing, multi-tenant cities, real GIS/parcel lookup, drawing/plan image analysis, email/notifications, hearing scheduling, cross-city ordinance benchmarking, PDF generation of the report.

## Architecture
- `src/lib/llm.ts` - the only module that talks to a model (`isMock`, `streamChat`, `structured`, `generateReport`) plus all deterministic mock templates.
- `src/lib/rules.ts` - rule engine; `retrieval.ts` - MiniSearch index over code sections and permit-trigger scoring; `prompts.ts` - all prompts; `review.ts` - rules then LLM; `store.ts` - JSON file store at `$DATA_DIR/db.json`.
- `src/data/` - 26 fictional code sections, 6 permit types with rules, 3 sample applications.
- `src/app/api/*` - chat, permit-types, code-sections, precheck, applications (+attachments, review, report), seed, extract.
- UI in `src/app` (plain CSS in `globals.css`, no Tailwind).

## GitHub tools used
- [vercel/ai](https://github.com/vercel/ai) - Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`)
- [vercel/next.js](https://github.com/vercel/next.js) - Next.js 16
- [colinhacks/zod](https://github.com/colinhacks/zod) - schemas
- [lucaong/minisearch](https://github.com/lucaong/minisearch) - keyword retrieval
- [unjs/unpdf](https://github.com/unjs/unpdf) - PDF text extraction
- [vitest-dev/vitest](https://github.com/vitest-dev/vitest) - tests

## Setup and run
```bash
cd 2026-11-18-verdant
npm install
cp .env.example .env.local   # optional; works with no key (mock mode)
npm run dev                  # http://localhost:3000
```
Production: `npm run build && npm start`. Checks: `npm run typecheck`, `npm run lint`, `npm test`, `npm run smoke` (needs a prior `npm run build`; starts `next start` on a free port with a temp data dir, runs the HTTP checks, stops the server).

Open `/staff`, click "Seed sample applications", open APP-1001 (ADU with 3 ft side setback, no site plan), click "Run review", then "Draft staff report".

## Environment variables
| Name | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Leave empty for mock mode |
| `ANTHROPIC_MODEL` | Default `claude-opus-5-5` (no date suffix; no `temperature` sent) |
| `LLM_MOCK` | `1` forces mock mode even with a key |
| `DATA_DIR` | Directory of `db.json`, default `./data` (git-ignored) |

## Mock mode
With no `ANTHROPIC_API_KEY` (or `LLM_MOCK=1`) every model output is a deterministic template built from retrieved sections and rule results (no randomness), so the whole app works offline. The UI shows a "Mock mode" badge. With a key, `@ai-sdk/anthropic` is used (`streamText`, `generateObject`, `generateText`).

## Known limitations
- Live (non-mock) mode was not exercised here (no API key available); only the code path is written and type-checked.
- PDF extraction via unpdf is wired up (`/api/extract`, `/api/applications/[id]/attachments`) but only `.txt` flow was reasoned about; no PDF fixture is tested.
- Retrieval is keyword-only; permit matching is trigger-word based. Rules are keyed to R-1 numbers regardless of selected zoning.
- JSON file store: no locking, single-process only. No auth - anyone can open `/staff`.
- A live LLM recommendation is not forced to agree with failing rule checks.
- The markdown renderer is minimal.

## Next 3 things to build
1. Zoning-aware rules (R-2/C-1 values) and conditional rules driven by the code text.
2. Plan-sheet analysis (extract dimensions from drawings) to auto-fill setbacks.
3. Auth with applicant/staff roles, status notifications, and real persistence (SQLite/Postgres).
