# BUILD_PROMPT.md — 2026-11-21 Oasive clone ("MuniWatch")

Verbatim prompts sent to the Sonnet build subagent (Agent tool, subagent_type general-purpose, model sonnet), in order.

## Round 1 — initial build prompt

You are building a working, runnable clone of a startup product inside an existing git repository. Work ONLY inside the folder `/home/user/startup-clones/2026-11-21-oasive/` (it already contains `SPEC.md` and `BUILD_LOG.md`; do not modify those two files or anything outside the folder). Do NOT commit or push anything. Do NOT create files anywhere else in the repository.

Environment facts: Node 22.23.5, npm 10.9.9, Python 3.11 available; Playwright + Chromium are pre-installed globally (`require('playwright')` works from any directory; do not run `playwright install`). There is NO `ANTHROPIC_API_KEY` in this environment, so everything must be verified in mock mode. Outbound HTTPS goes through a proxy; npm installs work. Use the scratchpad `/tmp/claude-0/-home-user-startup-clones/fe065d4e-7de8-5dde-8d02-c551fd8f14c5/scratchpad/` for any throwaway files.

Build the working end-to-end clone exactly per the spec below. Rules:
- Aim for a real, runnable app, not a stub. Use the specified open-source libraries (Next.js 16, Vercel AI SDK `ai` v7 + `@ai-sdk/anthropic` v4, zod v4, unpdf, minisearch, rss-parser, @mozilla/readability + jsdom, vitest) instead of reinventing them. Scaffold with `npx create-next-app@latest . --ts --app --no-tailwind --eslint --src-dir --import-alias "@/*" --use-npm --yes` (or equivalent) inside the folder, then add dependencies. Before writing LLM code, read `node_modules/ai/dist/index.d.ts` to confirm which structured-output API the installed version exports (`generateObject` vs `generateText` + `Output.object`) and use the one that exists.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets.
- Add a `.gitignore` appropriate for the stack (node_modules, .env*, .next, out, build output, data/, coverage, *.log, playwright screenshots). The seed content under `src/seed/` is committed; the generated `data/` directory is not.
- Verify it: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then `npm run seed`, start the app with `npm run start` (production build) in the background on port 3000, run `npm run smoke` against it, and drive the UI with Playwright at 1280 px and 390 px (check `document.documentElement.scrollWidth <= window.innerWidth` and collect console errors) for the five screens listed in acceptance check 4. Fix errors before finishing. Do not claim something works unless you actually ran it. Stop any background server when done (kill the process you started).
- Write a thorough `README.md` in the folder: what the original company does (with links to https://oasive.ai and https://www.ycombinator.com/companies/oasive), what this clone does and what it skips, architecture summary (a short text diagram of the request flow), the GitHub tools used (table: name, link, what it covers), exact setup and run steps (install, seed, dev, build, start, test, smoke), environment variables, mock vs live mode, known limitations, and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Oasive, and that all obligors, documents and news articles are fictional.
- Keep the committed folder small: no node_modules, no .next, no data/, no screenshots. A `package-lock.json` is fine.
- Report back, in this order: (1) what was built (file tree summary and a short description of each major module); (2) exactly which verification commands were run and their results, including the number of vitest tests passed, the smoke output line, and the Playwright check results per screen; (3) anything that does not work or deviates from the spec; (4) your total input and output token usage as best you can report it.

The full SPEC.md follows.

---

# SPEC — Oasive clone ("MuniWatch") — 2026-11-21

Independent learning clone of **Oasive** (YC F26, https://oasive.ai, YC page
https://www.ycombinator.com/companies/oasive): "AI credit research for municipal bond investors."
Not affiliated with Oasive.

## What the product does
Oasive is a research analyst for institutional municipal-bond teams. One analyst may cover up to
1,000 borrowers ("obligors": cities, hospitals, water authorities, charter schools, airports…) and
the warning signs live in local newspapers, board-meeting minutes, audited financials and official
statements. Oasive reads those sources daily, tags credit-relevant items to the right obligor, flags
rating / distress / state-oversight events, builds an **obligor page** with multi-year sourced
financials and sector metrics (days cash on hand for hospitals, operating margin, debt service
coverage, top taxpayers for cities), lets users keep **watchlists**, and answers natural-language
questions ("Ask") with citations that point to the source document and page.

The clone, **MuniWatch**, reproduces that product layer end to end on a small seeded universe:
documents in → sourced financials + flagged events → obligor pages, watchlist feed, cited Q&A.

## Core user flows (implement all five)
1. **Obligor directory and obligor page** — `/` lists the seeded obligors (name, state, sector,
   latest rating, number of open flags, last document date). `/obligors/[id]` shows: header (name,
   sector, state, rating, outstanding debt), a **Financials** table (one column per fiscal year, rows
   per metric; every cell shows a small "source" link that opens the citation: document title + page
   + the quoted line), **sector metrics** (hospital: days cash on hand, operating margin, debt service
   coverage; city/county: fund balance % of expenditures, top-10 taxpayer concentration, pension
   funded ratio; utility: debt service coverage, days cash, rate increases; school: enrollment,
   fund balance %), the **Events** list (flags from documents and news, newest first, with severity
   badges), the **Documents** list, and the **Ask** box (flow 5).
2. **Ingest a document** — on the obligor page, upload a `.pdf`, `.txt` or `.md` (audit / annual
   comprehensive financial report, official statement, budget, board agenda or minutes) and choose a
   document type and fiscal year. Server-side: extract text **per page** (PDF via `unpdf`
   `extractText(..., { mergePages: false })`; for .txt/.md split on `=== Page N ===` markers, else
   treat as one page), store the pages, chunk them (~800 chars, page-aware), index the chunks in a
   MiniSearch index for that obligor, then run the **extraction pipeline** (below) to produce
   `metrics[]` (name, value, unit, fiscalYear, citation{docId, page, quote}) and `events[]` (type,
   severity, headline, summary, dollarAmount?, citation). Results are persisted and the obligor page
   re-renders with the new figures. Each seeded obligor ships with 2–3 bundled sample documents
   (plain text with page markers, written by the builder, fictional but realistic) that are ingested
   by `npm run seed` so the demo has data without any upload.
3. **News monitoring** — `/news` is a feed of news items across all obligors. Items enter via
   (a) `POST /api/news/ingest` with `{ url }` (fetch page, extract article with Readability) or
   `{ title, text, source, publishedAt }` (paste), or (b) `npm run seed`, which loads ~12 bundled
   sample articles (fictional local-news stories: a hospital system missing a covenant, a city
   under state fiscal oversight, a rating downgrade, a water authority rate increase, a routine
   non-credit story that should be filtered out, etc.). For each item the **news pipeline** decides
   `creditRelevant` (bool), `obligorIds[]` (tagging against the seeded obligor names/aliases),
   `eventType` (`rating | distress | state_oversight | leadership | litigation | budget | debt_issuance | other`),
   `severity` (`low | medium | high`), a two-sentence `summary`, and `dollarAmounts[]`. Non-relevant
   items are kept but hidden by default (toggle "show filtered"). Relevant items also appear as
   Events on the tagged obligor pages. Feed filters: obligor, event type, severity, watchlist.
   Live RSS is optional: if `NEWS_FEEDS` (comma-separated RSS URLs) is set, `POST /api/news/poll`
   pulls them with `rss-parser` and runs the pipeline; not required for acceptance.
4. **Watchlists** — `/watchlists`: create a watchlist (name), add/remove obligors, see the combined
   events feed for the list, and a count of `high` severity events in the last 30 days per obligor.
   The directory shows a star to add an obligor to the default watchlist. Persisted in the JSON store.
5. **Ask (cited Q&A)** — on the obligor page and on `/ask` (where the user picks one or two
   obligors): the question is answered from the indexed chunks. Retrieve top-8 chunks per obligor
   with MiniSearch (fuzzy + prefix on, fields `text`, boost `docTitle`), build the prompt with
   numbered sources `[1]..[n]` (docTitle, page, chunk text), and the LLM answers in ≤ 200 words
   citing `[n]` markers; the response returns `{ answer, citations: [{n, docId, docTitle, page, quote}] }`
   and the UI renders the answer with clickable citation chips that reveal the quoted chunk.
   Compare mode asks the same question for two obligors and shows the answers side by side.
   Mock mode: the answer is a templated paragraph that lists the top-3 retrieved chunks with their
   citations (so citations and retrieval are still exercised end to end).

## LLM pipeline design (live vs mock)
- A single module `src/lib/llm.ts` exposes `extractFromDocument(pages, docMeta, obligor)`,
  `classifyNews(item, obligors)`, and `answerQuestion(question, sources)`. `mode()` returns
  `"live"` when `ANTHROPIC_API_KEY` is set and `LLM_MODE !== "mock"`, else `"mock"`. Every API
  response and the UI header show a `mock`/`live` badge.
- Live: Vercel AI SDK `ai` v7 with `@ai-sdk/anthropic` v4 and the model from `ANTHROPIC_MODEL`
  (default `claude-sonnet-5-5`). Structured outputs use zod v4 schemas. Check the installed version's
  API (`generateObject` vs `generateText` + `Output.object`) by reading
  `node_modules/ai/dist/index.d.ts`; use whichever exists, do not guess.
  - Extraction: one call per document (pages joined with `\n\n[[page N]]\n\n` markers, capped at
    ~60k chars; longer docs are processed in page windows and merged). The schema asks for metrics
    with `fiscalYear`, `value` (number), `unit` (`usd | pct | days | x | count`), and a `page` plus a
    short verbatim `quote` for each; and for events with the fields above. The code then verifies
    each citation: the quote (normalised whitespace, case-insensitive, first 40 chars) must occur
    on the cited page, otherwise search all pages and fix the page number, otherwise mark
    `verified:false`. Unverified citations are shown with a warning icon, never dropped silently.
  - News classification: one call per item with the obligor list (id, name, aliases, state, sector)
    in the prompt; the model returns the schema above. Tagging is also done deterministically by
    name/alias match and unioned with the model's answer.
  - Ask: `generateText` with the numbered sources; the system prompt forbids facts not in the
    sources and requires `[n]` citations after each sentence that uses a source.
- Mock (deterministic, no network): extraction uses regex patterns over the page text for lines like
  `Days cash on hand: 142`, `Operating margin: -3.1%`, `Debt service coverage: 1.42x`,
  `Total governmental fund balance: $18,400,000`, `Unassigned fund balance ... 21.3% of expenditures`,
  `Enrollment: 1,240`, `Pension funded ratio: 61%`, `Top ten taxpayers ... 24.8%`, `Rating: Baa2`,
  plus event heuristics (lines containing `covenant`, `default`, `oversight`, `emergency manager`,
  `downgrade`, `resign`, `lawsuit`, `deficit`, `rate increase`, `issued $...` and a dollar amount).
  News classification uses keyword lists per event type and name/alias matching. The bundled sample
  documents and articles are written so that mock extraction produces a full, sensible obligor page.
  Mock mode is the default in this sandbox (no API key) and is what the acceptance checks run.

## Stack
- **Next.js 16 (App Router) + TypeScript**, React, one global stylesheet (no Tailwind). Node 22.
- **Vercel AI SDK** `ai` ^7 + `@ai-sdk/anthropic` ^4, **zod** ^4.
- **unpdf** ^2 for PDF text extraction per page (pure JS, works in Node route handlers).
- **minisearch** ^7 for chunk retrieval (BM25-like; one index per obligor, rebuilt from the stored
  chunks on demand and cached in memory).
- **rss-parser** ^3 for optional RSS polling; **@mozilla/readability** + **jsdom** for URL article
  extraction (SSRF guard: reject non-http(s), localhost, private IP ranges unless `ALLOW_PRIVATE_URLS=1`).
- **vitest** for unit tests; a plain `node scripts/smoke.mjs` HTTP smoke test against `next start`.
- **Storage**: JSON files under `data/` (gitignored) via `src/lib/store.ts`:
  `data/obligors.json`, `data/documents/<docId>.json` (meta + pages + chunks),
  `data/news.json`, `data/watchlists.json`. Seed data lives in `src/seed/` (committed).
- No auth, no billing, no accounts, no real market data.

## Data model (`src/lib/types.ts`)
```ts
type Sector = "city" | "county" | "hospital" | "water_utility" | "school" | "airport" | "university";
type Obligor = { id: string; name: string; aliases: string[]; state: string; sector: Sector;
  rating?: string; outstandingDebtUsd?: number; description: string;
  metrics: Metric[]; events: Event[]; documentIds: string[]; createdAt: string; updatedAt: string };
type Citation = { docId: string; docTitle: string; page: number; quote: string; verified: boolean };
type Metric = { id: string; name: string; value: number; unit: "usd"|"pct"|"days"|"x"|"count";
  fiscalYear: number; citation: Citation };
type EventType = "rating"|"distress"|"state_oversight"|"leadership"|"litigation"|"budget"|"debt_issuance"|"other";
type Event = { id: string; obligorId: string; type: EventType; severity: "low"|"medium"|"high";
  headline: string; summary: string; dollarAmounts: number[]; date: string;
  source: { kind: "document"; citation: Citation } | { kind: "news"; newsId: string } };
type DocType = "audit" | "official_statement" | "budget" | "board_minutes" | "other";
type Document = { id: string; obligorId: string; title: string; type: DocType; fiscalYear?: number;
  filename: string; pageCount: number; pages: string[]; chunks: Chunk[]; status: "indexed"|"error";
  mode: "mock"|"live"; createdAt: string };
type Chunk = { id: string; docId: string; page: number; text: string };
type NewsItem = { id: string; title: string; text: string; source: string; url?: string; publishedAt: string;
  creditRelevant: boolean; obligorIds: string[]; eventType: EventType; severity: "low"|"medium"|"high";
  summary: string; dollarAmounts: number[]; mode: "mock"|"live"; createdAt: string };
type Watchlist = { id: string; name: string; obligorIds: string[]; createdAt: string };
```

## Screens and endpoints
Screens: `/` directory (+ star to watchlist, search box filtering by name/state/sector),
`/obligors/[id]` (financials, sector metrics, events, documents, upload form, Ask box),
`/news` (feed + filters + paste/URL ingest form), `/watchlists`, `/ask` (compare mode).
Header on every page: app name, nav, `mock`/`live` badge.

API (all JSON, errors as `{ error }` with proper status codes):
- `GET /api/obligors`, `GET /api/obligors/[id]` (with metrics, events, documents meta)
- `POST /api/obligors/[id]/documents` (multipart: `file`, `type`, `fiscalYear?`, `title?`) → document meta
  + extraction summary; `GET /api/documents/[docId]` (meta + pages); `GET /api/documents/[docId]/page/[n]`
- `POST /api/obligors/[id]/ask` `{ question }` → `{ answer, citations, mode }`
- `POST /api/ask` `{ question, obligorIds: [a, b?] }` → `{ results: [{obligorId, answer, citations}], mode }`
- `GET /api/news?obligorId&type&severity&watchlistId&includeFiltered`, `POST /api/news/ingest`,
  `POST /api/news/poll` (RSS; 400 if `NEWS_FEEDS` unset)
- `GET/POST /api/watchlists`, `PATCH /api/watchlists/[id]` `{ name?, add?: string[], remove?: string[] }`, `DELETE /api/watchlists/[id]`
- `POST /api/seed` (idempotent: resets `data/` from `src/seed/`) and `npm run seed` (calls the same code directly, not over HTTP)
- `GET /api/health` → `{ ok: true, mode }`

## Seed universe (write this content; fictional names, realistic numbers)
Six obligors: a mid-sized city (state oversight story), a county, a regional hospital system
(covenant pressure: days cash falling 2022→2024), a water & sewer authority (rate increase, new
bond issue), a charter-school network (enrollment decline), and a regional airport (recovering
passengers). Each obligor: 2–3 documents (audit for the last 2–3 fiscal years in ONE multi-year
document is fine, an official statement or budget, and a board-minutes document that contains at
least one flaggable item with a dollar amount). ~12 news articles, at least 2 not credit-relevant,
at least one tagging two obligors, and dates spread over the last 60 days relative to seed time.

## Environment variables (`.env.example`)
- `ANTHROPIC_API_KEY` — optional; absent ⇒ mock mode.
- `ANTHROPIC_MODEL` — default `claude-sonnet-5-5`.
- `LLM_MODE` — `mock` forces mock mode even with a key.
- `NEWS_FEEDS` — optional comma-separated RSS URLs for `/api/news/poll`.
- `ALLOW_PRIVATE_URLS` — `1` to allow localhost/private URLs for article ingest (tests only).
- `DATA_DIR` — default `./data`.

## Skip
Auth, billing, multi-tenant, real bond/CUSIP data, EMMA/MSRB integration, video transcription of
board meetings (Oasive transcribes recordings; the clone ingests minutes text only), pricing /
rich-cheap analytics, agency MBS and macro products, email alerts, scheduled polling.

## Acceptance checks (all must pass in mock mode, no network)
1. `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (≥ 15 vitest tests: chunker is
   page-aware; citation verifier fixes a wrong page and flags an unfindable quote; mock metric
   regexes extract every metric type; news keyword classifier + alias tagging; MiniSearch retrieval
   returns the chunk containing a known phrase; watchlist add/remove; SSRF guard rejects
   `file://`, `http://127.0.0.1`, `http://10.0.0.1`; store round-trip) and `npm run build` succeed.
2. `npm run seed` creates 6 obligors, ≥ 12 documents, ≥ 12 news items; every obligor has ≥ 4
   metrics with `verified:true` citations and ≥ 1 event; ≥ 2 news items are `creditRelevant:false`.
3. `npm run smoke` (starts nothing itself; expects the app on `PORT`, default 3000) checks: health
   is mock; directory lists 6 obligors; the hospital obligor has `days cash on hand` for ≥ 2 fiscal
   years with citations whose page text contains the quote; uploading a generated `.txt` with page
   markers containing `Days cash on hand: 97` to an obligor adds a verified metric on the right
   page; uploading a small generated PDF (write it with `pdf-lib` as a dev dependency, or ship a
   tiny fixture PDF under `tests/fixtures/`) extracts text and indexes ≥ 1 chunk; `/api/news/ingest`
   with a pasted downgrade story about a seeded obligor yields `creditRelevant:true`,
   `eventType:"rating"`, the obligor id in `obligorIds`, and the event appears on `GET /api/obligors/[id]`;
   a pasted story about a bake sale is `creditRelevant:false`; watchlist create → add two obligors →
   feed filtered by `watchlistId` contains only their items → remove works; `/api/obligors/[id]/ask`
   returns ≥ 1 citation whose `docId`/`page` exist and whose `quote` occurs on that page;
   `/api/ask` with two obligors returns two results; `/api/news/ingest` with `url: "http://127.0.0.1/x"`
   returns 400; unknown obligor returns 404. Prints `SMOKE PASSED` and exits 0.
4. The UI renders at 1280 px and 390 px without horizontal scroll: directory, an obligor page with
   financials table + events + Ask answer with citation chips, the news feed with filters, the
   watchlists page, and the compare page. Verify with Playwright (pre-installed) and check
   `document.documentElement.scrollWidth <= window.innerWidth` and zero console errors.
5. README documents setup, seed, run, env vars, mock vs live, limitations, next steps, and states
   the clone is independent and not affiliated with Oasive.
