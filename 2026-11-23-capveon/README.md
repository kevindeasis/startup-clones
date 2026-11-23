# PreBid: an independent learning clone of Capveon

> **Independent learning clone. Not affiliated with, endorsed by, or derived from the code of Capveon.**
> Everything in the seed data (agencies, documents, awards, contacts, the company profile, vendor and person names) is **fictional**.
> No real procurement portals, council minutes or agencies are scraped or referenced.

Part of the daily AI-startup clone series. Date: 2026-11-23.

## What the original company does

[Capveon](https://capveon.ai) (YC F26, [YC page](https://www.ycombinator.com/companies/capveon)) builds "AI for finding, understanding, and winning government work for manufacturers and contractors". Public-infrastructure information (water, wastewater, heavy civil, industrial) is scattered across council and board minutes, budgets, capital improvement plans, procurement portals and engineering specs. Per its site, Capveon turns that into:

- **Early signals**: projects spotted in minutes, budgets and plans months before a bid is posted.
- **Opportunities**: open bids as cards with a fit score against what you sell.
- **Bid review**: answers with page citations; reads specs and addenda and checks them against your requirements.
- **Pursuits**: a task plan per bid with owners and due dates, plus first drafts from your past bids.
- **Spend / contacts**: what each agency buys, from whom, for how much, and who decides.
- Change tracking of addenda over time.

## What this clone does

PreBid reproduces that product layer end to end on **seeded, fictional public documents**:

| Flow | Where | What it does |
|---|---|---|
| 1. Profile + Signals feed | `/profile`, `/` | Edit the company capability profile; every extracted signal is a card sorted by fit (desc) then later stage, with category/stage chips, value, timing, fit band (strong >=70, possible 40-69, weak <40), one-line rationale and a source line (document, page, verbatim quote). Filters + MiniSearch full-text search. "Track" starts a pursuit. |
| 2. Ingestion -> extraction | `/documents`, `/documents/new`, `/documents/[id]` | Paste or upload `.txt`/`.md`/`.pdf`; page splitting (`--- page N ---`, form feed, or ~3,000-char pseudo-pages); per-page signal extraction; evidence-quote verification; in-document dedupe; cross-document merge (later stage wins, sources appended); deterministic fit scorer. |
| 3. Bid review | `/documents/[id]` for solicitations | Key fields with page numbers (bid due, pre-bid, questions deadline, bid bond, engineer's estimate), requirements checklist with `meetsProfile` computed by rules, and a cited **Ask** box (BM25 top-6 chunks over the solicitation and its addenda). |
| 4. Pursuits | `/pursuits`, `/pursuits/[id]` | 8-task template planned backward from the bid due date (or a stage-based horizon), owners from the profile team, up to 3 requirement-specific suggested tasks, checkboxes, drafted cover letter (<=250 words, stored as a note, copy button), and **addendum tracking** (change pipeline, due-date shift, timeline events, requirements re-run). |
| 5. Agency spend | `/agencies`, `/agencies/[id]` | Spend by fiscal year (inline SVG bars), top vendors, by category, documents, signals, contacts. |

### Skipped (per spec)
Auth, billing, multi-tenant, live scraping/crawling, procurement-portal / CRM / Slack integrations, SSO, email, PDF rendering, drawings/OCR, vector embeddings, background jobs (extraction runs inline in the request).

## Architecture

```
Next.js 16 App Router (React 19, TypeScript)
  src/app/**            pages (server components read the store directly) + client islands in components/
  src/app/api/**        JSON route handlers (zod-validated, errors are { error } with 4xx)
  src/lib/store.ts      JSON files in data/store/*.json, in-process mutex + atomic rename
  src/lib/pipeline.ts   ingest -> split pages -> extract -> verify -> dedupe/merge -> fit score -> requirements / changes
  src/lib/fit.ts        deterministic fit scorer (category 40, keywords 30, region 15, value 15)
  src/lib/requirements.ts  rule engine for meetsProfile + key-field extraction
  src/lib/planner.ts    task template, backward due dates, addendum date shifting
  src/lib/qa.ts         MiniSearch (BM25) retrieval over page chunks
  src/lib/llm/          getLLM(): live (AI SDK + Anthropic) or mock (deterministic heuristics), same zod shapes
  data/seed/            fictional profile, agencies, 9 documents, awards, contacts (committed)
  data/store/           runtime JSON store (gitignored)
  scripts/seed.ts       reset store + load seed + run extraction in the current mode
  scripts/smoke.ts      HTTP end-to-end checks against a running app
```

Design notes:
- **LLM does language, code does arithmetic.** Fit scores, due dates, quote verification, dedupe/merge, `meetsProfile` and due-date shifting are all deterministic code; the LLM only extracts, answers, drafts and writes the rationale sentence.
- **Hallucination guard.** Any extracted signal/requirement/change whose evidence quote is not found (case/whitespace-insensitive) in its page text is dropped.
- **Live calls** are sequential per page chunk with `maxRetries: 2`; on failure the document is marked `failed` with the error message.
- Fiscal year = calendar year of the award date (simplification).

## Open-source tools used

| Tool | Link | Role |
|---|---|---|
| Next.js 16 | https://github.com/vercel/next.js | App Router UI + API routes, `next build`/`next start` |
| React 19 | https://github.com/facebook/react | UI |
| Vercel AI SDK (`ai` ^7) | https://github.com/vercel/ai | `generateText` + `Output.object` structured outputs in live mode |
| `@ai-sdk/anthropic` ^4 | https://github.com/vercel/ai/tree/main/packages/anthropic | Anthropic provider for the AI SDK |
| zod ^4 | https://github.com/colinhacks/zod | LLM output schemas and API input validation |
| MiniSearch ^7 | https://github.com/lucaong/minisearch | BM25 retrieval over page chunks (Ask) and signals search |
| pdf-parse ^2 | https://github.com/mehmet-kozan/pdf-parse | PDF text extraction (dynamic import in the upload route only) |
| Vitest ^5 | https://github.com/vitest-dev/vitest | Unit tests |
| tsx | https://github.com/privatenumber/tsx | Runs `scripts/*.ts` |
| ESLint + eslint-config-next | https://github.com/eslint/eslint | Lint |
| TypeScript | https://github.com/microsoft/TypeScript | Types |

## Setup and run

Requires Node 22+.

```bash
cd 2026-11-23-capveon
npm install
cp .env.example .env      # optional; with no ANTHROPIC_API_KEY the app runs in mock mode
npm run seed              # resets data/store and loads the fictional seed (runs extraction)
npm run dev               # http://localhost:3000
```

Production build, plus the verification suite:

```bash
npm run typecheck && npm run lint && npm test
npm run build
npm run seed
PORT=3123 npm run start &        # next start honours PORT
PORT=3123 npm run smoke          # or BASE_URL=http://localhost:3123 npm run smoke
```

`npm run smoke` expects a freshly seeded store (it creates a pursuit and ingests an addendum); run `npm run seed` again before re-running it.
`POST /api/seed` re-seeds a running dev server (disabled when `NODE_ENV=production` unless `ALLOW_SEED=1`).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Optional. When unset the app runs in mock mode. Never commit it. |
| `LLM_MODE` | auto | `mock` forces mock; `live` (or unset) uses live mode when a key is present. |
| `PREBID_MODEL` | `claude-sonnet-5-5` | Model id used in live mode. |
| `PORT` | `3000` | Port for `next dev`/`next start`; also read by `scripts/smoke.ts`. |
| `BASE_URL` | `http://localhost:$PORT` | Smoke-test target. |
| `DATA_DIR` | `./data/store` | Where the JSON store lives. |
| `ALLOW_SEED` | unset | Set to `1` to allow `POST /api/seed` in production mode. |

## Mock vs live mode

- **Mock** (default without a key): deterministic heuristics in `src/lib/llm/mock.ts` (project-cue + infrastructure-noun paragraph detection, keyword category table, stage cues, first-`$` value parsing, sentence-level requirement regexes, BM25 + term-overlap answers with a "Not found in this document." threshold, template cover letter, changed/extended/replaced sentence detection with date parsing). It is tuned to pass every acceptance check on the seed and is intentionally simple; it will miss a lot on arbitrary real documents.
- **Live**: `src/lib/llm/live.ts` calls `generateText({ model: anthropic(PREBID_MODEL), output: Output.object({ schema }), maxRetries: 2 })` with the short system prompts in `src/lib/llm/prompts.ts`. Both modes return the same zod-validated shapes. The header badge shows `mode: mock` or `mode: live (model)`.

The live path type-checks and is wired end to end but was **not exercised against the real API** in this build (no API key was available).

## API

`GET /api/health`, `GET /api/signals?category&stage&agencyId&minFit&q`, `GET|PUT /api/profile`, `GET|POST /api/documents` (JSON or multipart), `GET /api/documents/[id]`, `GET|POST /api/documents/[id]/ask`, `POST /api/documents/[id]/reextract`, `GET|POST /api/pursuits` (`{signalId}` or `{documentId}`), `GET /api/pursuits/[id]`, `POST /api/pursuits/[id]/draft`, `PATCH /api/tasks/[id]`, `GET /api/agencies`, `GET /api/agencies/[id]`, `POST /api/seed`.

## Known limitations

- Mock heuristics are brittle on real-world text; live mode is untested here.
- A pursuit is created from the solicitation's own dates. Addenda ingested **before** a pursuit exists are shown on the document page and in the requirements checklist, but only change a pursuit that already exists at ingest time.
- Pursuit creation is idempotent per signal/document (a second Track returns the existing pursuit).
- Page splitting for PDFs relies on pdf-parse page output; scanned PDFs (no text layer) yield nothing, there is no OCR.
- Retrieval is chunk-level BM25 only; no embeddings or reranking. Ask over a solicitation also searches its addenda, but conflicting values (original vs addendum) are both surfaced rather than resolved.
- The JSON store is single-process (in-process mutex); not safe for multiple server instances. No auth.
- Extraction runs inline in the request, so large documents in live mode can take a while.
- Fiscal year is simplified to the calendar year.

## Next 3 things to build

1. **Real addendum diffing over time**: keep versioned requirement sets per solicitation, show a per-field change history, and apply addenda ingested before a pursuit exists.
2. **Opportunity feed from a pluggable source adapter** (e.g. a documented RSS/CSV importer for public procurement notices) plus a pre-bid "signal -> solicitation" linker that attaches a new bid to the early signals it grew out of.
3. **Evaluation harness for the live extractor**: a labelled set of fictional pages with expected signals/requirements, scoring precision/recall of evidence quotes in mock vs live mode, run in CI.

## License / disclaimer

Learning project only. Capveon is the property of its owners; this repository contains no Capveon code, data or branding and is not affiliated with them.
