# BUILD_PROMPT.md — exact prompts sent to the Sonnet build subagent

## Round 1 — initial build prompt (verbatim)

```
You are building a working, runnable clone of an AI startup inside an existing git repository. Work ONLY inside the folder /home/user/startup-clones/2026-11-19-covera/ (it already contains SPEC.md, BUILD_LOG.md and BUILD_PROMPT.md — do not modify or delete those three files). Do not modify anything outside that folder. Do not run any git commit or git push.

Build the end-to-end clone exactly per the spec below. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (Next.js, Vercel AI SDK `ai` + `@ai-sdk/anthropic` + `@ai-sdk/react`, zod, unpdf, vitest) instead of reinventing them. Verify a package exists on npm before adding it; never invent packages.

Rules:
- Read all API keys from environment variables and ship a `.env.example`. Never commit or write real secrets.
- Add a `.gitignore` appropriate for the stack: node_modules, .next, out, build, data/ (the JSON store), .env and .env.* (but not .env.example), coverage, *.log, *.tsbuildinfo, next-env.d.ts.
- There is NO ANTHROPIC_API_KEY in this environment. The app must fully work in mock mode as described in the spec, deterministically. Keep the live path real (actual `generateObject`/`generateText` calls via `@ai-sdk/anthropic`) but it will not be exercised here.
- Verify it yourself: `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then start the app with `npm run start` (or `next start -p <port>`) in the background, run `npm run smoke` against it, and curl the pages listed in the acceptance checks. Fix every error before finishing. Do not claim something works unless you actually ran it. Stop any background server when done (kill the process).
- If `create-next-app` is slow or fails, scaffold the project by hand (package.json, tsconfig.json, next.config.ts, eslint.config.mjs, src/app/layout.tsx, src/app/page.tsx, src/app/globals.css).
- Write a thorough `README.md` in the folder: what the original company (Covera, YC F26, https://www.covera-agents.com, https://www.ycombinator.com/companies/covera) does; what this clone does and what it skips; architecture summary; the GitHub/open-source tools used (with links); exact setup and run steps; environment variables; mock mode; known limitations; and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Covera.
- Report back at the end with: (1) what was built (file tree summary), (2) exactly which verification commands you ran and their results (copy the key output lines, e.g. test counts, "SMOKE PASSED", HTTP status codes), (3) anything that does not work or deviates from the spec, and (4) your total input/output token usage as best you can tell.

===== SPEC.md (follow exactly) =====
# SPEC — Covera clone ("BrokerDesk") — 2026-11-19

Independent learning clone of **Covera** (YC F26, https://www.covera-agents.com,
YC page https://www.ycombinator.com/companies/covera). Not affiliated with Covera.

## What the original product does
Covera is an "AI-native OS for insurance brokers". A client request arrives by email; Covera opens an
opportunity, fills a risk profile from the client's emails/documents, keys every carrier portal
("even with partial data"), returns quotes side by side (premium, deductible, coverage), and after the
broker picks one it syncs the AMS and drafts the client summary. Other agents: submission intake
(collect missing documents, draft follow-up emails), quote comparison (coverage, deductibles,
exclusions), day-to-day account assistant, renewals, and cross-sell / account rounding (scan the book
for missing lines). A human approves every action; Covera never submits a quote on its own.
Customers are independent P&C agencies and captive agents (commercial lines: BOP, GL, workers' comp,
commercial auto, cyber, liquor liability).

## What the clone does
One Next.js app, "BrokerDesk", for a fictional agency ("Harbor Point Insurance"). Five modules:
1. **Intake** — paste a client email (or upload a `.txt`/`.pdf` attachment); the app extracts a
   structured **risk profile**, computes which fields each requested line of business still needs,
   and drafts a follow-up email asking for the missing items. Creates an **opportunity**.
2. **Quote** — "Key carrier portals": for each of 4 fictional carriers the app maps the risk profile
   to that carrier's own field schema and POSTs it to that carrier's **mock portal endpoint** inside
   the app, which rates it deterministically and returns a quote (or a decline / needs-info). The UI
   shows a per-carrier step log ("mapped 11 fields → submitted → quoted $4,120").
3. **Compare** — quotes side by side (premium, deductible, limits, included coverages, exclusions)
   with a deterministic diff plus an LLM-written recommendation and a client-ready proposal email.
   The broker **selects** a quote (human approval); nothing is auto-bound.
4. **Account rounding (cross-sell)** — a book-of-business page lists seeded accounts with their
   policies; a rule engine flags missing lines by industry (e.g. restaurant without liquor liability,
   any business with employees but no workers' comp, e-commerce without cyber) and the LLM drafts an
   outreach email per gap.
5. **Pipeline dashboard** — opportunities by stage (`intake` → `needs_info` → `quoting` → `quoted`
   → `selected`) with the risk profile, follow-ups and quotes attached.

## Stack (fixed)
- **Next.js 16 (App Router) + TypeScript**, `npm`, Node 22. Scaffold with
  `npx create-next-app@latest . --ts --app --no-tailwind --eslint --src-dir --import-alias "@/*" --use-npm --yes`
  (or by hand if that fails). Plain CSS (`globals.css` + CSS modules), no Tailwind.
- **Vercel AI SDK**: `ai` (7.x) + `@ai-sdk/anthropic` (4.x) + `@ai-sdk/react` (4.x) — `generateObject`
  for structured extraction, `generateText`/`streamText` for drafts, `useChat` only if a chat UI is added.
- **Anthropic** as the only provider. Model ID from `ANTHROPIC_MODEL`, default `claude-opus-5-5`
  (exact string, no date suffix). Do not send `temperature`.
- **zod** (4.x) for all schemas (risk profile, carrier field schemas, request bodies).
- **unpdf** (https://github.com/unjs/unpdf) to extract text from uploaded PDFs.
- **Storage**: JSON file store at `data/db.json` (git-ignored, created on first write) via `src/lib/store.ts`.
  No native modules, no external DB.
- **vitest** for unit tests; `scripts/smoke.mjs` (Node `fetch`) for the end-to-end smoke test.
- Verified on npm 2026-11-19: ai 7.0.177, @ai-sdk/anthropic 4.0.106, @ai-sdk/react 4.0.181, next 16.4.6,
  zod 4.6.7, unpdf 2.2.1, vitest 5.1.1. Use these or newer compatible versions; do not invent packages.

## Mock mode (required)
`src/lib/llm.ts` is the only module that calls a model. It exposes:
- `isMock()` — true when `LLM_MOCK=1` or `ANTHROPIC_API_KEY` is unset.
- `extractRiskProfile(text): Promise<RiskProfile>` — structured extraction (zod schema).
- `draftText(kind, context): Promise<string>` — follow-up email / recommendation / proposal / cross-sell email.
In mock mode outputs are **deterministic** and derived from the input (no randomness):
- extraction: a regex/keyword extractor (business name from "we are"/signature lines, address with a
  state + ZIP pattern, revenue/payroll/employees from `$1.2M revenue`, `12 employees`, `payroll $800k`
  forms, lines from keywords BOP/GL/general liability/workers comp/auto/cyber/liquor, industry from a
  keyword table, building details like sq ft / year built / sprinklered, prior claims from "claim").
- drafts: templated text filled from the structured data (missing-field list, cheapest vs best-coverage
  quote, named gaps).
The UI shows a "Mock mode — set ANTHROPIC_API_KEY for live AI" badge when mocked. The carrier
portals and rating are deterministic in both modes (they are not LLM calls).

## Seed data (ship in `src/data/`)
- `carriers.json`: 4 fictional carriers — `northstar` (BOP + GL, generalist), `ironbridge` (workers'
  comp specialist), `harborline` (commercial auto + BOP, declines restaurants with liquor), `cinder`
  (cyber + GL, requires `annualRevenue`). Each has `{id, name, lines[], fieldSchema (name → source
  path in RiskProfile + required flag), appetite rules (industries declined, max revenue, states),
  rating table (base rate per line, industry multipliers, revenue/payroll/vehicle factors, deductible
  options, default limits, exclusions[]), turnaroundMs}`.
- `industries.json`: ~12 industries (restaurant, retail, contractor, professional services,
  e-commerce, landscaping, auto repair, bakery, salon, software, trucking, wholesale) with class
  code, default hazard grade, and `recommendedLines[]` used by account rounding.
- `sample-emails/*.txt`: 4 realistic client emails (a restaurant asking for BOP + liquor, a
  landscaper asking for GL + auto + WC, an e-commerce shop asking for BOP + cyber with missing
  revenue, a contractor renewal with a prior claim). Email 3 must yield `needs_info` (revenue missing).
- `book.json`: 8 seeded accounts (name, industry, state, employees, policies[] with line, carrier,
  premium, expiration). At least 3 must produce rounding gaps (restaurant w/o liquor, 15 employees
  w/o WC, e-commerce w/o cyber).

## Data model (`src/lib/types.ts`)
```ts
type Line = 'bop'|'gl'|'wc'|'auto'|'cyber'|'liquor';
type RiskProfile = {
  businessName?: string; contactName?: string; contactEmail?: string;
  industry?: string; classCode?: string; description?: string;
  address?: { street?: string; city?: string; state?: string; zip?: string };
  yearsInBusiness?: number; annualRevenue?: number; annualPayroll?: number; employees?: number;
  building?: { squareFeet?: number; yearBuilt?: number; sprinklered?: boolean; owned?: boolean };
  vehicles?: number; priorClaims?: { count: number; notes?: string };
  requestedLines: Line[]; effectiveDate?: string; notes?: string;
};
type MissingItem = { line: Line | 'general'; field: string; why: string };
type Quote = {
  id: string; carrierId: string; carrierName: string; line: Line; status: 'quoted'|'declined'|'needs_info';
  premium?: number; deductible?: number; limits?: Record<string, number>; coverages?: string[];
  exclusions?: string[]; reason?: string; log: string[]; createdAt: string;
};
type Opportunity = {
  id: string; createdAt: string; stage: 'intake'|'needs_info'|'quoting'|'quoted'|'selected';
  sourceText: string; attachments: { filename: string; text: string }[];
  profile: RiskProfile; missing: MissingItem[]; followUpEmail?: string;
  quotes: Quote[]; comparison?: { summary: string; proposalEmail: string; recommendedQuoteId?: string };
  selectedQuoteId?: string;
};
type Account = { id: string; name: string; industry: string; state: string; employees: number;
  policies: { line: Line; carrier: string; premium: number; expiration: string }[] };
type Gap = { accountId: string; line: Line; reason: string; outreachEmail?: string };
```

## Screens (App Router)
- `/` — dashboard: pipeline columns by stage, counts, "New intake" button, mock-mode badge.
- `/intake` — textarea for the email, file input (`.txt`, `.pdf`), "Load sample" buttons for the 4
  sample emails, "Extract" → shows the risk profile as an editable form + missing-items list + follow-up
  email draft; "Save opportunity".
- `/opportunities/[id]` — profile, missing items, follow-up email, "Key carrier portals" button
  (streams or polls per-carrier logs), quotes grid, "Compare" → summary + proposal email + "Select
  this quote" buttons; selecting sets stage `selected`.
- `/book` — accounts table with policies; "Find gaps" → gap list with "Draft outreach" per gap.
- `/portal/[carrierId]` — a human-readable page showing that carrier's field schema and appetite (the
  "portal" the agent is keying), useful for the demo.

## API routes
- `POST /api/extract` — `{text, attachments?: [{filename, base64}]}` → `{profile, missing, followUpEmail}`.
  PDF attachments go through `unpdf`; the attachment text is appended to the email text before extraction.
- `POST /api/opportunities` — create; `GET /api/opportunities`; `GET/PATCH /api/opportunities/[id]`
  (PATCH updates profile or `selectedQuoteId`).
- `POST /api/opportunities/[id]/quote` — runs the quoting agent for every carrier whose `lines`
  intersect `requestedLines`: map profile → carrier field schema, POST to `/api/carriers/[carrierId]/quote`,
  store the Quote with its log. Returns all quotes. Stage becomes `quoted` (or stays `needs_info` if
  every carrier returned needs_info).
- `POST /api/carriers/[carrierId]/quote` — the **mock carrier portal**: validates the body against the
  carrier's own zod field schema (carrier-specific field names such as `insured_legal_name`,
  `gross_sales`, `num_fte`), applies appetite rules (decline with reason), rates deterministically,
  returns `{status, premium, deductible, limits, coverages, exclusions, reason}` per requested line.
- `POST /api/opportunities/[id]/compare` — deterministic diff + LLM/mock recommendation + proposal email.
- `GET /api/book` and `POST /api/book/gaps` → gaps; `POST /api/book/gaps/outreach` `{accountId, line}` → email.

## Pipeline / prompt design
- **Extraction prompt** (live): system prompt describing a commercial-lines CSR; user content is the
  email + attachment text; `generateObject` with the `RiskProfile` zod schema; instruct to leave
  unknown fields undefined, never guess revenue, normalise lines to the enum, parse dates to ISO.
- **Missing-items engine** (`src/lib/requirements.ts`, deterministic): per line, required fields —
  all lines: businessName, address.state, industry; bop: building.squareFeet, annualRevenue;
  gl: annualRevenue; wc: annualPayroll, employees; auto: vehicles; cyber: annualRevenue, employees;
  liquor: annualRevenue plus `notes` must mention liquor sales share (or flag it).
- **Carrier mapping** (`src/lib/carriers.ts`): a generic mapper walks `fieldSchema` and pulls values
  from the profile by path, records `mapped`/`missing` fields in the log, and submits even with partial
  data (the portal decides whether it can quote — mirrors "keys portals even with partial data").
- **Rating** (`src/lib/rating.ts`): `premium = round(base[line] * industryMult * sizeFactor * claimsFactor)`
  where sizeFactor uses revenue (bop/gl/cyber), payroll (wc) or vehicles (auto); claimsFactor
  1 + 0.15 * priorClaims.count. Deductible from the carrier's options; limits from defaults.
- **Comparison**: deterministic table of premium / deductible / limits / exclusions; cheapest and
  broadest-coverage picks computed in code; the LLM (or template) writes a 4–6 sentence recommendation
  and a proposal email that only cites numbers from the table.
- **Account rounding** (`src/lib/rounding.ts`): gap if an industry's `recommendedLines` include a
  line the account lacks; special rules: employees ≥ 1 and no `wc`; industry restaurant/bar and no
  `liquor`; e-commerce/software and no `cyber`.

## Environment variables (`.env.example`)
- `ANTHROPIC_API_KEY` — optional; when unset the app runs in mock mode.
- `ANTHROPIC_MODEL` — default `claude-opus-5-5`.
- `LLM_MOCK` — set `1` to force mock mode even with a key.
- `PORT` — default 3000 (used by the smoke script via `BASE_URL`).

## Skip
Auth, billing, multi-tenant, real AMS/carrier/email integrations, browser automation, bind/COI
generation, renewals scheduler, real policy forms, WhatsApp/Gmail ingestion.

## Acceptance checks (all must pass with NO API key set)
1. `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all exit 0.
2. `npm run smoke` (against `next start`) exits 0 and prints `SMOKE PASSED`; it must:
   a. POST sample email 1 (restaurant) to `/api/extract` → `requestedLines` contains `bop` and
      `liquor`, `industry` is restaurant, `businessName` non-empty.
   b. POST sample email 3 (e-commerce, no revenue) → `missing` includes `annualRevenue`; create the
      opportunity → stage `needs_info`; follow-up email mentions revenue.
   c. Create an opportunity from email 2 (landscaper) and run `/quote` → ≥ 3 quotes, at least one
      `quoted` with `premium > 0`, each quote has a non-empty `log`; `harborline` returns `declined`
      for the restaurant opportunity with liquor.
   d. `/compare` returns a `summary`, a `proposalEmail` and a `recommendedQuoteId` that exists in quotes.
   e. PATCH `selectedQuoteId` → stage `selected`.
   f. `/api/book/gaps` returns ≥ 3 gaps including a `liquor` gap and a `wc` gap; outreach email non-empty.
   g. `POST /api/carriers/cinder/quote` without `gross_revenue`-style required field → `needs_info`.
3. Unit tests (vitest) cover: mock extractor on the 4 sample emails, requirements engine, carrier
   mapping with partial data, rating determinism (same input → same premium), rounding rules.
4. `GET /` , `/intake`, `/book`, `/portal/northstar` return 200 and render without console errors.
5. Running the same extract twice in mock mode yields identical output.
===== end of SPEC.md =====
```

## Round 2 — fix prompt sent to the same Sonnet subagent (verbatim)

```
Review of your BrokerDesk build in /home/user/startup-clones/2026-11-19-covera/: typecheck, lint, 19 tests, build and `npm run smoke` (28 checks) all pass on my side too, and a Playwright run of the full UI flow (intake → save → key portals → compare → select → book → find gaps → draft outreach) shows no console or page errors. Two small fixes, then re-verify:

1. Horizontal overflow at phone width. At a 390px viewport, `/book` and `/portal/[carrierId]` (and the compare table on `/opportunities/[id]`) make the page scroll sideways because the `<table>` elements have no scroll container. Wrap each table in a `<div className="tableWrap">` with `overflow-x: auto; max-width: 100%;` in globals.css (and give the table a sensible `min-width` if needed) so `document.documentElement.scrollWidth <= clientWidth` at 390px on `/`, `/intake`, `/book`, `/portal/northstar` and an opportunity page. Also make sure the `.board` pipeline grid and the quote cards grid wrap/stack at narrow widths rather than forcing width.

2. Follow-up email when nothing is missing. For an opportunity with zero missing items the mock follow-up currently says "could you send over the following? - (nothing further needed right now)". Change the mock draft (and the live prompt instruction) so that when `missing` is empty it writes a short confirmation instead: thank the client, state that the agency has everything needed for the requested lines, and that it is going to market with carriers now. Keep the existing behaviour when items are missing (the smoke check that the e-commerce follow-up mentions revenue must still pass). Add one unit test for the empty-missing case.

Rules as before: stay inside the folder, do not touch SPEC.md / BUILD_LOG.md / BUILD_PROMPT.md, no git commit or push, no new packages. Then re-run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, start `npx next start -p 3100`, run `BASE_URL=http://localhost:3100 npm run smoke`, kill the server, and report the exact results plus a one-line summary of what you changed.
```
