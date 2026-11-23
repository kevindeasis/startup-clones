# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Prompt 1 — initial build (Agent tool, subagent_type "general-purpose", model "sonnet")

```
You are building a working, runnable clone of a YC startup's product inside an existing git repository.
Work ONLY inside this folder: /home/user/startup-clones/2026-11-23-capveon/ (it already contains SPEC.md,
BUILD_LOG.md and BUILD_PROMPT.md — do not edit or delete those three files). Do not modify anything outside
that folder. Do not run git commit or git push. Do not create or switch git branches.

Build the end-to-end clone exactly per the spec below. Aim for a real, runnable app, not a stub. Use the
specified open-source libraries instead of reinventing them. Scaffold Next.js by hand (write package.json
etc. yourself; do not use create-next-app or any interactive CLI). Pin dependency versions to the ones named
in the spec's "Stack" section (ai ^7, @ai-sdk/anthropic ^4, next ^16, zod ^4, minisearch ^7, pdf-parse ^2,
vitest ^5, tsx). Use React 19 with Next 16.

Hard requirements:
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets.
  There is NO ANTHROPIC_API_KEY in this environment, so the app must run fully in mock mode; the live mode
  must still be implemented (Vercel AI SDK `generateText` + `Output.object` with `@ai-sdk/anthropic`).
- Add a `.gitignore` appropriate for the stack: node_modules, .next, out, dist, .env, .env.local,
  data/store/, *.log, coverage, .DS_Store.
- Verify it: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run seed`,
  then start the built app (`PORT=3123 npm run start` in the background) and run `npm run smoke` against it
  (the smoke script must read PORT / BASE_URL from env). Fix errors before finishing. Do not claim it works
  unless you actually ran it. Kill the background server when done (and make sure no `next start` process
  is left running).
- Write a thorough `README.md` in the folder: what the original company (Capveon, https://capveon.ai, YC
  F26, https://www.ycombinator.com/companies/capveon) does, what this clone does and what it skips,
  architecture summary, the GitHub/open-source tools used (name + link + role), exact setup and run steps,
  environment variables, mock vs live mode, known limitations, and the next 3 things to build. State
  clearly that it is an independent learning clone not affiliated with Capveon, and that all seed data
  (agencies, documents, awards, contacts, the company profile) is fictional.
- Keep the folder small: no vendored binaries, no generated store files, no screenshots over 200 KB.

Report back (this is important): (1) what was built, file by file in brief; (2) EXACTLY which verification
commands you ran and their results (test counts, build output summary, seed counts, each smoke step and
its pass/fail); (3) anything that does not work or deviates from the spec; (4) your total input and output
token usage as best you can estimate.

===== SPEC.md (verbatim) =====
# SPEC — Capveon clone ("PreBid") — 2026-11-23

Independent learning clone of **Capveon** (YC F26, https://capveon.ai, YC page
https://www.ycombinator.com/companies/capveon): "AI for finding, understanding, and winning
government work for manufacturers and contractors." Not affiliated with Capveon.

## What the product does
Capveon is a government-sales system for equipment manufacturers, distributors and contractors who
sell into public infrastructure (water/wastewater, heavy civil, industrial). Public-project
information is scattered across council and board meeting minutes, budgets, capital improvement
plans, procurement portals and engineering specs. Capveon's modules, per its site:
- **Early signals** — projects found in meeting minutes, budgets and plans *before* a bid is posted
  ("months before the bid: the system flags council or board activity that suggests a future project").
- **Opportunities** — open bids/tenders as cards with a **fit score** against what you sell.
- **Bid review** — "answers to your questions on each bid, with page citations"; reads every page
  including specs and addenda and checks them against your requirements.
- **Pursuits** — a task plan per bid with owners and due dates, plus first drafts written from your
  past bids.
- **Spend / Contacts** — what each agency buys, from whom, for how much; who decides.
- Change tracking of addenda over time.

The clone, **PreBid**, reproduces that product layer end to end on **seeded, fictional public
documents** (no live scraping, no procurement-portal integrations, no CRM): a company capability
profile + a corpus of agency documents in → extracted early signals and opportunities with fit scores,
cited bid-review Q&A and a requirements checklist, a pursuit task plan with a drafted cover letter,
addendum change tracking, and an agency spend profile.

## Core user flows (implement all five)
1. **Company profile + Signals feed** — `/profile` shows and edits the single company profile
   (name, what we sell as a free-text paragraph, `categories[]` from a fixed list
   `water | wastewater | stormwater | roads_bridges | buildings | energy | industrial | it_telecom`,
   `keywords[]` of products/capabilities, `regions[]` (fictional states/counties), `minValue` /
   `maxValue` project-value band, `certifications[]` e.g. "AWWA C-series", "DBE", "bonding capacity
   $5M"). `/` is the **Signals feed**: every extracted `Signal` as a card sorted by fit score desc,
   then stage (later stage first). Card: project title, agency, category chip, stage chip
   (`discussion → planned → budgeted → design → solicitation → awarded`), estimated value (or
   "not stated"), expected timing, fit score 0–100 with band (≥70 strong / 40–69 possible / <40
   weak) and the one-line fit rationale, and a "Source" line: document title + page number + the
   quoted evidence sentence. Filters: category, stage, agency, min fit; search box (MiniSearch over
   title + agency + evidence). "Track" button creates a Pursuit (flow 4).
2. **Document ingestion → signal extraction** — `/documents` lists documents (title, agency, kind
   `minutes | cip | budget | solicitation | addendum | other`, date, pages, signals count, status);
   `/documents/new` accepts paste (textarea) or upload of `.txt` / `.md` / `.pdf` (pdf-parse for PDF;
   for text files a line `--- page N ---` or form-feed `\f` splits pages, otherwise split every ~3,000
   characters into pseudo-pages). Required fields: title, agency (select existing or type new), kind,
   date. On submit the **extraction pipeline** runs per document: for each page chunk the LLM returns
   `signals[]` with `{ projectTitle, category, stage, estimatedValue?: number, valueText?: string,
   timing?: string, summary (≤40 words), evidenceQuote (verbatim ≤ 300 chars from the page),
   confidence 0–1 }`. Deterministic post-processing: drop signals whose `evidenceQuote` is not found
   (case/whitespace-insensitive) in the page text; dedupe within the document by normalized title;
   merge with an existing `Signal` for the same agency with a near-identical title (keep the later
   stage, append the new source). Then the **fit scorer** (deterministic code in `src/lib/fit.ts`,
   not LLM) scores each signal 0–100: category match 40 pts (exact category in profile; 15 if
   adjacent, e.g. water↔wastewater↔stormwater), keyword overlap 30 pts (fraction of profile keywords
   found in title+summary+evidence, capped), region match 15 pts (agency region in profile regions),
   value band 15 pts (inside band; 7 if unknown). The LLM (or mock) then writes a one-line
   `fitRationale` given the score inputs. `/documents/[id]` shows the document pages (page nav), its
   signals, and for `solicitation`/`addendum` kinds the Bid review panel (flow 3).
3. **Bid review: cited Q&A + requirements checklist** — on a `solicitation` document page: a
   **Requirements checklist** (auto-built on ingest for solicitations): `requirements[]` with
   `{ text, kind: deadline | bond | insurance | certification | spec | submission | experience |
   other, page, quote, meetsProfile: yes | no | unknown, note }` where `meetsProfile` is computed by
   simple deterministic rules against the profile (certifications list, bonding capacity vs. bond
   amount if stated, value band) and `unknown` otherwise. Key fields surfaced at the top: bid due
   date/time, pre-bid meeting, questions deadline, bid bond %, engineer's estimate if stated — each
   with page number. **Ask** box: question → retrieve top-6 page chunks with MiniSearch (BM25) over
   that document (+ its addenda) → LLM answers in ≤ 120 words with inline citations like `[p.4]`
   and returns `citations[]` `{ page, quote }`; the UI renders citations as links that jump to the
   page. If the answer is not in the document, the answer must say so (mock: returns "Not found in
   this document" when no chunk scores above a threshold). `GET/POST /api/documents/[id]/ask`.
4. **Pursuits: task plan + drafted cover letter + addendum tracking** — "Track" on a signal or
   "Start pursuit" on a solicitation creates a `Pursuit` at `/pursuits/[id]`: header (project, agency,
   stage, fit, bid due date if known), **Task plan** generated by the **pursuit planner**: a fixed
   template (`Confirm fit & go/no-go`, `Register on portal / request plans`, `Attend pre-bid`,
   `Submit questions`, `Pricing & subs`, `Bond & insurance certs`, `Assemble submission`, `Submit`)
   whose due dates are computed deterministically backward from the bid due date (or, with no due
   date, from a stage-based horizon: solicitation 21 days, design 90, budgeted 180, planned 365,
   discussion 540), with owners from a small team list on the profile (`team[]` of `{name, role}`),
   plus up to 3 extra LLM-suggested tasks specific to the requirements (e.g. "Provide AWWA C-series
   test certificates", page-cited). Tasks have checkboxes (`PATCH /api/tasks/[id]`). **Draft**
   button: LLM writes a ≤ 250-word cover letter / capability statement for this bid from the profile
   and the two most relevant `pastBids[]` on the profile (seeded, fictional) — stored as a `Note`
   on the pursuit with a Copy button. **Addendum tracking**: `/documents/new` with kind `addendum`
   and `parentDocumentId` (select a solicitation) runs the **change pipeline**: LLM returns
   `changes[]` `{ field: due_date | questions_deadline | spec | quantity | bond | other, before?,
   after?, summary, page, quote }`; deterministic code applies `due_date` changes to the linked
   pursuit (recomputes task due dates for not-done tasks), appends a `PursuitEvent` per change to
   the pursuit timeline, and re-runs the requirements checklist including the addendum. `/pursuits`
   lists pursuits with stage, next task due, open task count.
5. **Agency spend profile** — `/agencies/[id]`: agency name, region, type; **Spend** from seeded
   `Award` rows (vendor, category, amount, date, description): total by fiscal year (inline SVG
   bars), top vendors, by category; **Documents** from this agency; **Signals** from this agency;
   **Contacts** (seeded `Contact` rows: name, title, role chip `decision_maker | procurement |
   engineer`). `/agencies` lists agencies with document count, signal count, 3-year spend.

## Stack and libraries (use these, do not reinvent)
- **Next.js 16 (App Router) + TypeScript**, Node 22. Scaffold by hand (no interactive CLI):
  `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `src/app/**`. Plain CSS in
  `src/app/globals.css` (CSS variables, light/dark via `prefers-color-scheme`); no Tailwind.
- **Vercel AI SDK** `ai@^7` + `@ai-sdk/anthropic@^4` for all LLM calls: `generateText` with
  `Output.object({ schema })` for structured outputs (zod schemas in `src/lib/schemas.ts`). Model
  from `PREBID_MODEL` env, default `claude-sonnet-5-5`.
- **zod@^4** for schemas and API input validation.
- **minisearch@^7** for BM25 retrieval over page chunks (flow 3) and the signals search (flow 1).
- **pdf-parse@^2** for PDF text extraction (dynamic import inside the API route only).
- **vitest@^5** for unit tests; **tsx** for scripts.
- **Data store**: JSON files under `data/store/*.json` through one module `src/lib/store.ts`
  (read-modify-write with an in-process mutex and atomic rename). `data/store/` is gitignored;
  `data/seed/**` is committed. No database server.

## Data model (`src/lib/types.ts`)
- `Profile { id: 'default', name, description, categories[], keywords[], regions[], minValue,
  maxValue, certifications[], bondingCapacity?, team[] {name, role}, pastBids[] {title, agency,
  year, outcome: won | lost | pending, summary} }`
- `Agency { id, name, region, type: city | county | district | state | authority, population? }`
- `Document { id, agencyId, title, kind, date, parentDocumentId?, pages[] {n, text}, status:
  ingested | extracted | failed, signalIds[], requirements?[], createdAt }`
- `Signal { id, agencyId, projectTitle, category, stage, estimatedValue?, valueText?, timing?,
  summary, fitScore, fitBreakdown {category, keywords, region, value}, fitRationale, confidence,
  sources[] {documentId, page, quote}, pursuitId?, createdAt, updatedAt }`
- `Requirement { id, text, kind, page, quote, meetsProfile, note }` (embedded in Document)
- `Pursuit { id, signalId?, documentId?, agencyId, title, stage, dueDate?, status: active | won |
  lost | dropped, taskIds[], noteIds[], events[] {id, at, type, summary, documentId?, page?},
  createdAt }`
- `Task { id, pursuitId, title, owner, dueDate, done, source: template | llm, page? }`
- `Note { id, pursuitId, kind: draft | note, text, createdAt }`
- `Award { id, agencyId, vendor, category, amount, date, description }`
- `Contact { id, agencyId, name, title, role, email? }`

## Screens and endpoints
Pages: `/` signals feed, `/profile`, `/documents`, `/documents/new`, `/documents/[id]`,
`/pursuits`, `/pursuits/[id]`, `/agencies`, `/agencies/[id]`. Shared layout with top nav and a
"mode: mock | live (model id)" badge from `/api/health`.
API (JSON, zod-validated, errors `{ error }` with 4xx): `GET /api/health` → `{ ok, mode, model,
counts }`; `GET /api/signals?category&stage&agencyId&minFit&q`; `GET/PUT /api/profile`;
`GET /api/documents`, `POST /api/documents` (multipart or JSON: title, agencyId | agencyName, kind,
date, text | file, parentDocumentId?) → runs extraction (and requirements for solicitations, changes
for addenda) and returns the document with signals; `GET /api/documents/[id]`;
`POST /api/documents/[id]/ask { question }` → `{ answer, citations[] }`;
`POST /api/documents/[id]/reextract`; `GET/POST /api/pursuits` (`{ signalId } | { documentId }`);
`GET /api/pursuits/[id]`; `POST /api/pursuits/[id]/draft`; `PATCH /api/tasks/[id] { done }`;
`GET /api/agencies`, `GET /api/agencies/[id]` (with spend aggregates); `POST /api/seed` (dev only).

## LLM pipeline design (`src/lib/llm/*`)
One `getLLM()` returning `{ mode: 'mock' | 'live', extractSignals, writeFitRationale,
extractRequirements, answerQuestion, suggestTasks, draftLetter, extractChanges }`. **Live** uses the
AI SDK with the system prompts below; **mock** (when `ANTHROPIC_API_KEY` is unset or
`LLM_MODE=mock`) is deterministic, heuristic and must make every acceptance check pass on the seed:
- mock `extractSignals`: split page into paragraphs; a paragraph is a signal if it contains a
  project cue (`project | replacement | rehabilitation | expansion | upgrade | construction |
  improvements | study | design | RFP | IFB | bid | procurement`) and an infrastructure noun;
  category from a keyword table (`pump|water main|treatment|AWWA → water; sewer|lift station|
  wastewater|WWTP → wastewater; storm|culvert|drainage → stormwater; road|pavement|bridge|
  resurfacing → roads_bridges; ...`); stage from cues (`discussed|consider|study → discussion;
  planned|five-year|CIP|FY20xx → planned; budget|appropriat|approved funding → budgeted;
  design|engineering services|30%|60%|90% → design; RFP|IFB|bids due|sealed bids → solicitation;
  awarded|notice of award → awarded`); value from the first `$` amount (parse `$1.2M`, `$850,000`);
  title from the first capitalised noun phrase before the cue or the paragraph's first 8 words;
  evidenceQuote = first sentence containing the cue.
- mock `extractRequirements`: regex for `due|deadline|bond|insurance|certif|AWWA|ASTM|NSF|
  experience|years|submit|copies|pre-bid`, one requirement per matching sentence with its page.
- mock `answerQuestion`: BM25 top chunk → return the 1–2 sentences with the highest term overlap,
  cited; below a score threshold → "Not found in this document."
- mock `suggestTasks`: one task per `certification`/`bond` requirement with `meetsProfile != yes`.
- mock `draftLetter`: template filled from profile + requirements. mock `extractChanges`: sentences
  in the addendum containing `revised|changed|extended|replace|delete|add` → one change each; a date
  following `due|deadline` → `due_date` change with the parsed ISO date.
Live prompts (short, in `src/lib/llm/prompts.ts`): extraction returns only facts stated on the page,
verbatim evidence quotes, `stage` from the fixed enum, `null` for unknown values; Q&A must cite
pages and say when the answer is absent; drafts must not invent credentials beyond the profile.
Both modes must return the same zod-validated shapes. Live calls are per page chunk, sequential,
with `maxRetries: 2`; on failure the document is marked `failed` with the error message.

## Seed data (`data/seed/`, all fictional; `npm run seed` loads it and runs extraction in the
current mode)
- `profile.json`: **Northline Pump & Valve** — manufacturer's rep selling submersible and
  vertical turbine pumps, check/gate valves, SCADA control panels and lift-station packages;
  categories `water, wastewater, stormwater`; keywords (`pump, pump station, lift station, valve,
  SCADA, VFD, wet well, force main, booster`); regions `Cascadia` (fictional state) counties
  `Brightwater, Copperline, Fernhollow`; value band 100k–15M; certifications `AWWA C-series,
  NSF/ANSI 61, UL 508A panels`; bonding capacity 5M; team of 3; 3 pastBids (2 won, 1 lost).
- `agencies.json`: 5 agencies (City of Brightwater; Fernhollow Water District; Copperline County
  Public Works; Town of Larkmoor; Cascadia Dept. of Transportation).
- `documents/*.md` (9 docs, 2–6 pages each, realistic voice, with `--- page N ---` markers):
  3 council/board **minutes** (one with a pump-station discussion and a "$1.2M" estimate; one with
  a road resurfacing program; one approving design funding for a lift station), 2 **CIP** excerpts
  (multi-year tables incl. a "Fernhollow Booster Station Replacement FY2027 $2.4M"), 1 **budget**
  excerpt, 2 **solicitations** (RFP "Mill Creek Lift Station Rehabilitation" with bids due
  2026-12-18 2:00 PM, pre-bid 2026-12-02, questions due 2026-12-09, 5% bid bond, AWWA C508 check
  valves, NSF 61, engineer's estimate $1.85M; IFB "Route 9 Resurfacing Phase 2" asphalt, 10% bond),
  1 **addendum** to the lift-station RFP (bids due moved to 2027-01-08 2:00 PM; valve spec changed
  C508 → C508 or C515; adds a second pump). Add a `documents/index.json` listing title, agency,
  kind, date, parent.
- `awards.json`: ~40 awards across agencies/years 2023–2026 (vendors, categories, amounts).
- `contacts.json`: ~12 contacts.

## Environment variables (`.env.example`)
`ANTHROPIC_API_KEY=` (optional; absent → mock), `LLM_MODE=` (`mock` | `live`, default auto),
`PREBID_MODEL=claude-sonnet-5-5`, `PORT=3000`, `DATA_DIR=./data/store`.

## Skip
Auth, billing, multi-tenant, live scraping/crawling, procurement-portal and CRM/Slack integrations,
SSO, email, PDF rendering, drawings/OCR, vector embeddings, background jobs (extraction runs inline
in the request).

## Acceptance checks (all must pass; `scripts/smoke.ts` automates the API ones)
1. `npm install`, `npm run typecheck`, `npm run lint`, `npm test` (≥ 15 vitest tests covering fit
   scorer, stage ordering/merge, page splitting, requirements rule engine, due-date computation,
   addendum due-date application, mock extraction on a fixture paragraph), `npm run build` all exit 0.
2. `npm run seed` in mock mode loads 1 profile, 5 agencies, 9 documents, ≥ 40 awards, ≥ 12 contacts
   and extracts ≥ 8 signals; at least one signal each with stage `discussion|planned`, `budgeted|
   design` and `solicitation`; the lift-station RFP signal has a higher fit score than the Route 9
   resurfacing signal, and the resurfacing signal is in the `weak` band.
3. With the app running (`npm run start` after build, or `npm run dev`), `npm run smoke` passes:
   health reports mode `mock`; `GET /api/signals?category=wastewater` returns only wastewater signals
   sorted by fit desc; `POST /api/documents/[rfpId]/ask {"question":"When are bids due?"}` returns an
   answer containing `December 18` (or `2026-12-18`) and a citation with the correct page; asking
   about something absent ("What is the warranty period for the roof?") returns a not-found answer
   with no citations; the RFP requirements include a `bond` item (5%) and a `certification` item
   (NSF 61) marked `meetsProfile: yes`; `POST /api/pursuits {documentId: rfpId}` creates ≥ 8 tasks all
   with due dates ≤ 2026-12-18 and ≥ 1 `llm`-source task; `PATCH /api/tasks/[id] {done:true}`
   persists; `POST /api/pursuits/[id]/draft` returns a note of 80–300 words mentioning the agency
   and the profile company name; `POST /api/documents` with the addendum text and
   `parentDocumentId: rfpId` returns ≥ 2 changes including a `due_date` change to 2027-01-08, the
   linked pursuit's `dueDate` becomes 2027-01-08 and its open tasks' due dates move accordingly, and
   the pursuit timeline gains ≥ 2 events; `GET /api/agencies/[brightwaterId]` returns spend by
   fiscal year with a non-zero total and ≥ 1 contact; `GET /` and `/pursuits/[id]` return 200 HTML.
4. Uploading a 2-page `.txt` with `--- page 2 ---` via `POST /api/documents` (multipart) produces a
   document with 2 pages and ≥ 1 signal when the text contains a water-main replacement paragraph.
5. `git status` inside the folder shows no `node_modules`, `.next`, `data/store` or `.env` files.
===== end of SPEC.md =====
```
