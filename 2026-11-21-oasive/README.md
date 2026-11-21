# MuniWatch - an Oasive learning clone (2026-11-21)

> **Independent learning clone. Not affiliated with, endorsed by, or derived from the code of Oasive.**
> **All obligors, documents, figures and news articles in this repository are fictional.**
> Nothing here is investment advice.

## What the original company does

[Oasive](https://oasive.ai) (YC F26, [YC page](https://www.ycombinator.com/companies/oasive)) builds "AI credit research for municipal bond investors". One analyst at an institutional muni team may cover up to ~1,000 borrowers (cities, hospitals, water authorities, charter schools, airports), and the warning signs hide in local newspapers, board minutes, audits and official statements. Oasive reads those sources daily, tags credit-relevant items to the right obligor, flags rating / distress / state-oversight events, builds obligor pages with multi-year sourced financials and sector metrics, supports watchlists, and answers natural-language questions with citations to the source document and page.

## What this clone does

MuniWatch reproduces that product layer end to end on a small seeded universe (6 fictional obligors, 15 documents, 13 news articles):

1. **Obligor directory and obligor page** - rating, open flags, last document; per-obligor financials table (one column per fiscal year, every cell has a "source" disclosure with document title, page and the quoted line), sector metrics cards, events with severity badges, documents list.
2. **Document ingest** - upload `.pdf` / `.txt` / `.md`, choose type and fiscal year. Text is extracted per page (PDF via `unpdf`, text split on `=== Page N ===`), chunked page-aware (~800 chars), indexed with MiniSearch, then run through the extraction pipeline to produce metrics and events with verified citations.
3. **News monitoring** - paste text or give a URL (Readability extraction behind an SSRF guard). A news pipeline decides credit relevance, tags obligors (deterministic name/alias match unioned with the model), event type, severity, two-sentence summary and dollar amounts. Non-relevant items are kept but hidden ("Show filtered"). Optional RSS polling.
4. **Watchlists** - create lists, add/remove obligors, combined events feed, count of high-severity events in the last 30 days; a star on the directory toggles the default list.
5. **Ask (cited Q&A)** - top-8 chunks per obligor via MiniSearch (fuzzy + prefix, title boost), numbered sources, answers with clickable `[n]` citation chips that reveal the quoted passage; compare mode shows two obligors side by side.

**Skipped** (as in the spec): auth, billing, multi-tenancy, real CUSIP/bond data, EMMA/MSRB integration, video transcription of board meetings (only minutes text is ingested), pricing / rich-cheap analytics, agency MBS and macro products, email alerts, scheduled polling.

## Architecture

```
Browser (Next.js App Router pages + small client components)
   |
   |  server components call src/lib/service.ts directly;
   |  client components call the JSON API
   v
Route handlers  src/app/api/**  (zod validation, errors as { error } + status)
   |
   v
src/lib/service.ts  --- orchestration -------------------------------------------+
   |                                                                              |
   |  upload:  extractPages (unpdf | split markers) -> chunkPages -> llm.extractFromDocument
   |           -> buildCitation (verify quote, fix page, else verified:false) -> store
   |  news:    llm.classifyNews (keywords/aliases in mock; model + alias tagging in live) -> store
   |  ask:     search.retrieve (MiniSearch, per obligor, cached) -> llm.answerQuestion
   v                                                                              |
src/lib/llm.ts  mode() = live if ANTHROPIC_API_KEY set and LLM_MODE != mock       |
   |-- live: Vercel AI SDK generateText + Output.object (zod v4) -> Anthropic      |
   '-- mock: src/lib/mock.ts regex / keyword / templated answers (no network) <----+
   v
src/lib/store.ts  JSON files under data/ (obligors, documents/<id>, news, watchlists)
```

Notes: news events shown on an obligor page are derived at read time from `news.json` (relevant items tagged to that obligor), while document events are stored on the obligor. Citations on answers are built from the retrieved chunks, so their `docId`/`page`/`quote` always resolve.

## GitHub / open-source tools used

| Name | Link | What it covers |
|---|---|---|
| Next.js 16 | https://github.com/vercel/next.js | App Router UI, route handlers, production server |
| React 19 | https://github.com/facebook/react | UI components |
| Vercel AI SDK (`ai` v7) | https://github.com/vercel/ai | `generateText` + `Output.object` structured output in live mode |
| `@ai-sdk/anthropic` v4 | https://github.com/vercel/ai/tree/main/packages/anthropic | Anthropic provider for the AI SDK |
| zod v4 | https://github.com/colinhacks/zod | LLM output schemas and API request validation |
| unpdf | https://github.com/unjs/unpdf | Per-page PDF text extraction (`extractText(..., { mergePages: false })`) |
| MiniSearch | https://github.com/lucaong/minisearch | In-memory BM25-style chunk retrieval (fuzzy + prefix) |
| rss-parser | https://github.com/rbren/rss-parser | Optional RSS polling |
| @mozilla/readability | https://github.com/mozilla/readability | Article extraction from URLs |
| jsdom | https://github.com/jsdom/jsdom | DOM for Readability |
| vitest | https://github.com/vitest-dev/vitest | Unit tests |
| pdf-lib | https://github.com/Hopding/pdf-lib | Generates the PDF used by the smoke test |
| tsx | https://github.com/privatenumber/tsx | Runs the TypeScript seed script |
| Playwright | https://github.com/microsoft/playwright | Used for the UI verification (not a project dependency) |

## Setup and run

Requires Node 22+ and npm.

```bash
npm install
cp .env.example .env.local   # optional; everything works without it (mock mode)
npm run seed                 # builds data/ from src/seed/ (6 obligors, 15 docs, 13 news items)
npm run dev                  # http://localhost:3000   (development)

npm run build                # production build
npm run start                # production server on :3000 (serve after build + seed)

npm run typecheck            # tsc --noEmit
npm run lint                 # eslint
npm test                     # vitest (19 tests)
npm run smoke                # HTTP smoke test against the running app (PORT, default 3000)
```

`npm run smoke` starts nothing itself: run `npm run seed && npm run start` first. The smoke test uploads files and creates a watchlist, so re-run `npm run seed` (or `POST /api/seed`) to reset the data afterwards.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Optional. Absent means mock mode. |
| `ANTHROPIC_MODEL` | Model for live mode (default `claude-sonnet-5-5`). |
| `LLM_MODE` | `mock` forces mock mode even when a key is present. |
| `NEWS_FEEDS` | Comma-separated RSS URLs for `POST /api/news/poll` (400 when unset). |
| `ALLOW_PRIVATE_URLS` | `1` allows localhost/private URLs in article ingest (tests only). |
| `DATA_DIR` | JSON store location (default `./data`, gitignored). |

## Mock vs live mode

`mode()` in `src/lib/llm.ts` returns `live` only when `ANTHROPIC_API_KEY` is set and `LLM_MODE` is not `mock`. Every API response and the header badge show `mock` or `live`.

- **Mock (default, deterministic, no network)**: extraction uses regex patterns over page text (days cash on hand, operating margin, debt service coverage, fund balances, enrollment, pension funded ratio, top-10 taxpayers, rate increases, enplanements, rating, outstanding debt) plus keyword event heuristics (covenant, default, oversight, emergency manager, downgrade, resign, lawsuit, deficit, rate increase, "issued $..."). News uses keyword lists per event type plus name/alias matching. Ask returns a templated paragraph listing the top-3 retrieved chunks with their `[n]` citations, so retrieval and citations are still exercised. All acceptance checks run in this mode.
- **Live**: `generateText` with `output: Output.object({ schema })` (the installed `ai` 7.0.x also still exports the deprecated `generateObject`; `Output.object` is the recommended API and is what is used). Extraction sends pages joined with `[[page N]]` markers in windows of about 60k chars and merges results; each citation is then verified (quote's first 40 normalised chars must appear on the cited page, else the page is corrected, else `verified:false` and the UI shows a warning). News classification sends the obligor list and unions the model's tags with deterministic alias tags. Ask uses a system prompt that forbids facts outside the numbered sources.

**The live path was written against the installed AI SDK types and type-checks, but it has not been run here because the sandbox has no API key.**

## API summary

`GET /api/health`, `GET /api/obligors`, `GET /api/obligors/[id]`, `POST /api/obligors/[id]/documents` (multipart), `POST /api/obligors/[id]/ask`, `POST /api/ask`, `GET /api/documents/[docId]`, `GET /api/documents/[docId]/page/[n]`, `GET /api/news`, `POST /api/news/ingest`, `POST /api/news/poll`, `GET|POST /api/watchlists`, `PATCH|DELETE /api/watchlists/[id]`, `POST /api/seed` (resets `data/`).

## Known limitations

- Mock extraction is regex-based and tuned to the bundled document phrasing; real filings would need live mode (or a much richer parser). Scanned PDFs have no OCR.
- Multi-column/table PDFs lose layout in `unpdf` text, so quotes may be fragmentary.
- JSON-file storage with whole-file rewrites: no locking, fine for one process and a handful of users, not for concurrency.
- Search indexes are in memory per server process and rebuilt when an obligor's documents change.
- Obligor rating comes only from document text (a news downgrade creates an event but does not change the rating field). Fiscal-year assignment in mock mode relies on headings or the form value.
- No authentication; upload and ingest endpoints are open. The SSRF guard blocks private ranges and checks DNS and one redirect hop but is not a hardened proxy.
- Turbopack prints a "dynamic filesystem access" tracing warning at build because the data directory is configurable.
- Live LLM mode is untested in this repository (no key was available).

## Next 3 things to build

1. Live-mode evaluation harness: gold-labelled fixtures to measure extraction/citation accuracy and news precision/recall, plus a mock-vs-live diff report.
2. Scheduled monitoring: cron-style RSS polling, de-duplication of syndicated stories, and email/Slack alerts for new high-severity events on watchlists.
3. A real database (SQLite or Postgres) with per-obligor metric history, source-document viewer with highlighted quotes, and board-meeting audio/video transcription feeding the same pipeline.
