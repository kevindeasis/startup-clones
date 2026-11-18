# SPEC — Verdant clone ("Permitly") — 2026-11-18

Independent learning clone of **Verdant** (YC S26, https://www.verdantapp.com, launch post
https://www.ycombinator.com/launches/RHI-verdant-helping-cities-process-permits-faster).
Not affiliated with Verdant.

## What the original product does
Verdant sells AI agents to local governments, starting with permitting. Residents chat with an
agent trained on the city's code to find out which permits they need, a guided intake portal
helps them file a complete application, AI completeness/plan review flags missing items and
code conflicts (e.g. a setback shortfall) with the relevant code citation, and after a decision
the system drafts staff reports / council memos. Cities pay per module used.

## What the clone does
A single Next.js app for a fictional city ("City of Pinecrest") with four modules:
1. **Permit discovery chat** — applicant describes a project; the assistant answers which
   permit(s) they need, citing municipal code sections retrieved by keyword search.
2. **Guided intake** — a form per permit type that validates required fields and runs an
   AI pre-check before submission ("you are missing a site plan").
3. **Completeness & compliance review** — staff open an application and run a review that
   returns a list of checks (pass / fail / needs_info) with a code citation and explanation,
   combining a deterministic rule engine with an LLM explanation pass.
4. **Staff report drafting** — one click produces a Markdown staff report / memo for the
   planning commission from the application and the review results.
Plus a **staff dashboard** listing applications and their status.

## Stack (fixed)
- **Next.js 16 (App Router) + TypeScript**, `npm`, Node 22. Create with
  `npx create-next-app@latest . --ts --app --no-tailwind --eslint --src-dir --import-alias "@/*" --use-npm --yes`
  (or scaffold by hand if that fails). Plain CSS modules / a single `globals.css`, no Tailwind.
- **Vercel AI SDK**: `ai` + `@ai-sdk/anthropic` + `@ai-sdk/react` for streaming chat and
  structured output (`generateObject`/`generateText`, `streamText`, `useChat`).
- **Anthropic** as the only provider. Model ID from `ANTHROPIC_MODEL`, default `claude-opus-5-5`.
  Do not append date suffixes. Do not send `temperature`.
- **zod** for schemas (structured outputs, request validation).
- **minisearch** (https://github.com/lucaong/minisearch) for keyword retrieval (BM25-like) over
  code sections — no embeddings, so retrieval works with no API key.
- **unpdf** (https://github.com/unjs/unpdf) to extract text from uploaded PDF attachments.
- **Storage**: a JSON file store at `data/db.json` (created on first write, git-ignored) via a
  small `lib/store.ts` with read/write helpers. No native modules, no external DB.
- **vitest** for unit tests. Node `fetch` in a `scripts/smoke.mjs` for the end-to-end smoke test.
- Verify every package exists on npm before use (all of the above were verified on 2026-11-18:
  ai 7.x, @ai-sdk/anthropic 4.x, @ai-sdk/react 4.x, next 16.x, minisearch 7.x, unpdf 2.x, zod 4.x).

## Mock mode (required)
`lib/llm.ts` is the only module that talks to a model. It exposes:
- `isMock()` — true when `LLM_MOCK=1` or `ANTHROPIC_API_KEY` is unset.
- `streamChat({system, messages})` — returns a streaming text result compatible with the chat route.
- `structured<T>({system, prompt, schema})` — returns an object validated by the zod schema.
In mock mode, outputs are deterministic and derived from the input (no randomness):
- discovery: pick the top retrieved permit types and compose a templated answer with citations;
- pre-check / review explanations: templated sentences built from the rule-engine result;
- staff report: templated Markdown filled from the application and checks.
The UI shows a small "Mock mode — set ANTHROPIC_API_KEY for live AI" badge when mocked.

## Seed data (ship in `src/data/`)
- `code-sections.json`: ~25 fictional Pinecrest Municipal Code sections, each
  `{id, title, chapter, text}`. Cover: zoning districts (R-1, R-2, C-1), setbacks (R-1 front 20 ft,
  side 5 ft, rear 15 ft), max height (R-1 30 ft, accessory 16 ft), lot coverage (R-1 40%),
  ADU rules (max 1,000 sq ft, 4 ft side/rear setback, owner occupancy not required, 1 parking
  space unless within 1/2 mile of transit), fences (max 6 ft side/rear, 4 ft front yard),
  decks (permit required if > 30 in above grade or > 200 sq ft), signs, home occupations,
  tree removal, grading, required documents (site plan, floor plan, elevations, title report),
  fees, hearing/noticing rules, and when planning commission review is required.
- `permit-types.json`: 6 permit types — `adu`, `fence`, `deck`, `addition`, `sign`,
  `home_occupation`. Each has `{id, name, description, triggers[], requiredFields[],
  requiredDocuments[], rules[]}` where `rules` reference code section ids and are evaluated by
  the rule engine (see below).
- `sample-applications.json`: 3 pre-filled applications used by the seed script and tests,
  including one ADU application with a 3 ft side setback (must FAIL the 4 ft rule) and a
  missing site plan (must produce needs_info).

## Data model (`src/lib/types.ts`)
```ts
type Applicant = { name: string; email: string; phone?: string };
type Attachment = { id: string; filename: string; kind: 'site_plan'|'floor_plan'|'elevations'|'other'; text: string; pages?: number };
type Application = {
  id: string; permitType: string; status: 'draft'|'submitted'|'in_review'|'reviewed'|'approved'|'needs_info';
  applicant: Applicant; address: string; parcel?: string; zoning: 'R-1'|'R-2'|'C-1';
  projectDescription: string;
  fields: Record<string, string|number|boolean>;   // permit-specific (e.g. sideSetbackFt, heightFt, floorAreaSqFt, lotAreaSqFt)
  attachments: Attachment[];
  review?: Review; report?: string; createdAt: string; updatedAt: string;
};
type Check = { id: string; title: string; status: 'pass'|'fail'|'needs_info'; citation: string; detail: string; source: 'rule'|'ai' };
type Review = { checks: Check[]; summary: string; recommendation: 'approve'|'approve_with_conditions'|'request_info'|'deny'; conditions: string[]; createdAt: string; mock: boolean };
```

## Rule engine (`src/lib/rules.ts`, deterministic, unit-tested)
Rules in `permit-types.json` use a tiny DSL:
`{ id, title, citation, kind: 'max'|'min'|'required_field'|'required_document'|'ratio_max', field?, value?, numerator?, denominator?, document? }`.
Examples: ADU `min sideSetbackFt 4` (cite the ADU setback section), ADU `max floorAreaSqFt 1000`,
R-1 `ratio_max floorAreaSqFt/lotAreaSqFt 0.40`, `required_document site_plan`.
Missing field or document → `needs_info`; violated → `fail`; else `pass`. Each check carries its
citation. The engine is used both for the intake pre-check and the staff review.

## Retrieval (`src/lib/retrieval.ts`)
Build a MiniSearch index over code sections (fields: title, text; boost title) at module load.
`searchCode(query, k=5)` returns sections with scores. Permit discovery also scores permit types
by matching `triggers[]` keywords against the query.

## Screens (App Router)
- `/` — landing: two cards, "I'm a resident" (→ `/apply`) and "I'm city staff" (→ `/staff`), plus the mock badge.
- `/apply` — discovery chat (useChat) on the left; right panel shows the permit types the assistant
  recommended with "Start application" buttons and the cited code sections.
- `/apply/[permitType]` — guided intake form rendered from `requiredFields`; textarea for project
  description; file input for attachments (PDF → unpdf text, .txt accepted); "Run pre-check"
  shows the checks inline; "Submit" creates the application (status `submitted`).
- `/staff` — dashboard table: id, permit type, address, applicant, status, created, actions.
  "Seed sample applications" button when the store is empty.
- `/staff/[id]` — application detail; "Run review" shows checks grouped by status with citations,
  summary and recommendation; "Draft staff report" renders Markdown; status controls
  (approve / request info).

## API routes
- `POST /api/chat` — body `{messages}`; retrieves code sections + candidate permit types for the
  latest user message, streams the assistant answer (system prompt includes retrieved sections);
  sets response header `x-permit-candidates` (JSON array of permit type ids) and `x-citations`.
- `GET /api/permit-types`, `GET /api/code-sections?q=`.
- `POST /api/precheck` — `{permitType, fields, attachments}` → `{checks, advice}`.
- `GET|POST /api/applications` ; `GET|PATCH /api/applications/[id]`.
- `POST /api/applications/[id]/attachments` — multipart upload, extracts text with unpdf.
- `POST /api/applications/[id]/review` — rule engine + LLM pass → stores and returns `Review`.
- `POST /api/applications/[id]/report` — returns `{report}` (Markdown) and stores it.
- `POST /api/seed` — loads sample applications.

## LLM pipeline design
- Discovery system prompt: "You are the City of Pinecrest permit assistant. Answer only from the
  code sections provided; cite sections as [§ id]. Say which permit types apply and what documents
  are needed. If unsure, say what you need to know." Include top-5 retrieved sections and the
  top-3 permit-type summaries in the prompt.
- Review: run the rule engine first; then one `structured()` call with the application, rule
  results and the cited code text to produce `{summary, recommendation, conditions, extraChecks[]}`
  where `extraChecks` are AI-sourced checks (`source:'ai'`) about the project description or
  attachment text that rules cannot see (e.g. "description mentions a second story but height is
  blank"). AI may not change rule check statuses.
- Staff report: one `generateText` call with a fixed Markdown template (Title, Summary, Project
  Description, Site & Zoning, Analysis of Checks table, Public Notice, Recommendation, Conditions).
- Keep prompts in `src/lib/prompts.ts`.

## Environment variables (`.env.example`)
```
ANTHROPIC_API_KEY=            # leave empty to run in mock mode
ANTHROPIC_MODEL=claude-opus-5-5
LLM_MOCK=                     # set to 1 to force mock mode even with a key
DATA_DIR=./data               # where db.json lives
```

## Skip
Auth, billing, multi-tenant cities, real GIS/parcel lookups, drawing/plan image analysis,
email/notifications, hearing scheduling, ordinance benchmarking across cities, PDF generation
of the staff report.

## Acceptance checks (the build must pass all of these, in mock mode, no API key)
1. `npm install`, `npm run typecheck` (tsc --noEmit), `npm run lint`, `npm run build` all exit 0.
2. `npm test` runs vitest: rule engine (fail on 3 ft setback, needs_info on missing site plan,
   pass otherwise, ratio rule), retrieval (query "backyard fence height" returns the fence section
   first), mock structured output validates against the zod schema.
3. `npm run smoke` starts the production server (`next start` on an unused port), then via fetch:
   GET `/` → 200 and contains "Pinecrest"; POST `/api/seed` → 3 applications; POST `/api/chat`
   with "I want to build a 6 foot fence in my backyard" → 200, streamed text mentions "fence",
   header `x-permit-candidates` contains `fence`; POST `/api/applications/<aduId>/review` → review
   with at least one `fail` (setback) and one `needs_info` (site plan) check, each with a
   non-empty citation; POST `/api/applications/<aduId>/report` → Markdown containing "Recommendation";
   then stops the server and exits 0.
4. README documents setup, env vars, mock mode, and the limitations above.
5. `.gitignore` excludes node_modules, .next, data/, .env*, coverage.
