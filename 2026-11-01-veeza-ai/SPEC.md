# Build spec — "Visa Copilot", a clone of Veeza AI (YC F26)

Date: 2026-11-01. Folder: `2026-11-01-veeza-ai/`. Original company: https://veeza.ai (YC profile: https://www.ycombinator.com/companies/veeza-ai).

## What the original product does

Veeza AI is an AI-assisted tourist-visa service aimed at travellers with "weak" passports (it started with Egyptian passport holders). Its tagline is "Tell us the destination. We'll apply for your visa." The public flow is:

1. Pick a destination (Schengen countries such as Croatia, Finland, Denmark, Norway, Sweden, Estonia, Malta, Greece; UK Standard Visitor; US B1/B2). One clear per-person package price. Up to five travellers per application.
2. Upload a passport photo/scan and answer a few questions. The AI extracts passport details and pre-fills the government forms.
3. "AI document verification" of supporting documents (bank statements, bookings, employment letters), plus a public "How strong is your visa application?" quiz that tells you what to fix and which papers you need ("a guide, never a visa decision").
4. A human visa expert reviews the prepared application; the traveller can request corrections before anything is submitted.
5. On full-service packages the team books the visa-centre/embassy appointment and notifies the traveller over WhatsApp.

The clone implements steps 1–4 as a self-serve web app ("Visa Copilot"). Step 5 (real appointment booking, WhatsApp, payments, human expert marketplace) is out of scope and stubbed in the UI.

## Core user flows to implement (all five are required)

1. **Start an application**: choose destination (from a seeded catalogue), nationality (default Egyptian, selectable), travel dates, purpose (tourism), number of travellers (1–5). Creates an application record and shows the per-destination document checklist and an illustrative "service fee" line.
2. **Passport extraction**: upload a passport image (JPEG/PNG) or PDF per traveller → LLM vision extracts structured fields (surname, given names, passport number, nationality, date of birth, sex, issue date, expiry date, issuing authority, MRZ lines if visible) with a per-field confidence. User can edit the fields before saving. Validity rule check runs immediately (expiry ≥ 3 months after planned departure from destination; passport issued within last 10 years; etc.).
3. **Document checklist + AI verification**: for each required document type (passport copy, photo, bank statement, employment/student letter, flight itinerary, hotel booking, travel insurance, cover letter — varies by destination), upload a file → the app extracts text (PDF via `pdf-parse`, images via LLM vision) and asks the LLM to return `{ matchesExpectedType, extracted: {...}, issues: [...], verdict: 'ok' | 'warning' | 'fail' }`. Deterministic consistency checks are layered on top (e.g. itinerary dates vs. travel dates, bank statement covers ≥ 3 months, insurance coverage ≥ €30,000 for Schengen, traveller name matches passport).
4. **Readiness score** ("How strong is your application?"): a deterministic score 0–100 computed from rule results (missing docs, failed checks, passport validity) plus an LLM-written short narrative with the top 3 fixes. Shown as a dashboard card with an explicit disclaimer: "A guide, never a visa decision."
5. **Form pre-fill + review**: generate a pre-filled application form PDF (our own clean layout that mirrors the field set of a Schengen short-stay application / UK visitor / US DS-160-style summary — do NOT bundle official government PDFs) with `pdfkit`, downloadable per traveller. A review page shows the application summary, status timeline (Draft → Documents → Prepared → Expert review (stub) → Appointment (stub)), and a "Request correction" note box that stores free-text notes against the application.

## Stack

- Next.js 16 (App Router) + TypeScript, `npm`. Tailwind CSS v4 for styling (no component library needed; keep UI clean and simple).
- Vercel AI SDK: `ai` + `@ai-sdk/anthropic` for all LLM calls (`generateObject`/`generateText` with Zod schemas). Default model: `claude-sonnet-4-5` (configurable via `LLM_MODEL`).
- Zod (v4 is fine, or v3 if the AI SDK version installed pins it — check `npm ls`) for schemas/structured output.
- `pdf-parse` for extracting text from uploaded PDFs.
- `pdfkit` for generating the pre-filled application form PDF.
- Drizzle ORM + `@libsql/client` (local SQLite file at `./data/visa.db`). If the native libsql binary fails to install in this environment, fall back to `better-sqlite3`, and if that also fails, a `lowdb`-style JSON store at `./data/db.json` behind the same repository interface. Document the choice in README.
- Uploaded files stored on disk under `./data/uploads/<applicationId>/` (gitignored).
- Node 22, no Docker required.

## Open-source libraries to use (verified on npm/GitHub on 2026-11-01)

| Library | Repo | Used for |
|---|---|---|
| Next.js | https://github.com/vercel/next.js | App Router UI + API routes |
| Vercel AI SDK (`ai`, `@ai-sdk/anthropic`) | https://github.com/vercel/ai | Structured LLM calls (vision extraction, doc verification, narrative) |
| Zod | https://github.com/colinhacks/zod | Schemas for structured outputs and API validation |
| pdf-parse | https://github.com/mehmet-kozan/pdf-parse | Text extraction from uploaded PDFs |
| pdfkit | https://github.com/foliojs/pdfkit | Generating the pre-filled application PDF |
| Drizzle ORM | https://github.com/drizzle-team/drizzle-orm | Typed SQLite access |
| libsql client | https://github.com/tursodatabase/libsql-client-ts | Local SQLite file driver |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss | Styling |

Do not add other heavy dependencies (no LangChain, no Prisma, no auth libraries).

## Data model (SQLite via Drizzle)

- `applications`: id (uuid), destinationCode, nationality, purpose, departureDate, returnDate, travellerCount, status (`draft|documents|prepared|review|appointment`), notes (text), createdAt, updatedAt.
- `travellers`: id, applicationId, index (1–5), passport JSON (extracted + edited fields), passportFile (path), passportConfidence JSON, createdAt.
- `documents`: id, applicationId, travellerId (nullable for shared docs like hotel booking), type (enum from checklist), filePath, mimeType, extractedText (truncated to 20k chars), verification JSON (`{matchesExpectedType, extracted, issues[], verdict}`), createdAt.
- `checks` (optional; may be computed on the fly instead): applicationId, code, severity, message.

Destination catalogue is **static TypeScript** in `src/lib/destinations.ts`: for each destination code (at least: HR Croatia, FI Finland, DK Denmark, NO Norway, SE Sweden, EE Estonia, MT Malta, GR Greece, GB UK Standard Visitor, US B1/B2): display name, visa type label, Schengen flag, required document list with short descriptions and rules (e.g. `bankStatementMonths: 3`, `insuranceMinCoverEUR: 30000`, `passportValidityMonthsAfterDeparture: 3`, `photoSpec`), illustrative service fee in USD, and a clearly labelled note "Requirements are illustrative and must be confirmed with the embassy/visa centre." Do not claim these are Veeza's actual prices or official requirements.

## Screens and endpoints

Pages (App Router):
- `/` — landing: tagline, destination grid (cards with illustrative fee), "Check how strong your application is" CTA.
- `/apply/new` — form: destination, nationality, dates, purpose, travellers → POST creates application → redirect to `/apply/[id]`.
- `/apply/[id]` — application workspace with tabs/sections: Travellers (passport upload + extracted fields editor), Documents (checklist with upload + verification results), Readiness (score card + narrative + fixes), Forms (download PDF per traveller), Review (summary, status timeline, correction notes).
- `/quiz` — the public "How strong is your visa application?" quiz: 6–8 multiple-choice questions (passport validity, previous Schengen/UK/US visas, employment, bank balance range, bookings, travel history) → deterministic score + LLM narrative, no login, nothing persisted.

API routes (`src/app/api/...`):
- `POST /api/applications` → create. `GET /api/applications/[id]` → full application with travellers, documents, computed checks and score.
- `POST /api/applications/[id]/travellers` (multipart: passport file) → extracts passport via LLM, saves traveller, returns fields + confidence. `PATCH /api/travellers/[id]` → save edited fields.
- `POST /api/applications/[id]/documents` (multipart: type, travellerId?, file) → extract text, verify via LLM, save, return verification.
- `GET /api/applications/[id]/readiness` → `{ score, band, ruleResults[], narrative, topFixes[] }`.
- `GET /api/applications/[id]/travellers/[tid]/form.pdf` → pre-filled PDF.
- `POST /api/applications/[id]/notes` → append correction note; `POST /api/applications/[id]/status` → advance status.
- `POST /api/quiz` → `{ score, band, narrative, fixes[] }`.

## LLM pipeline design

All LLM access goes through `src/lib/llm.ts`, which exports typed helpers and honours a **mock mode**: if `MOCK_LLM=1` or `ANTHROPIC_API_KEY` is missing, return deterministic canned outputs (a fixed sample passport, a plausible verification object keyed by document type, a fixed narrative) so the whole app and the acceptance checks run offline. Log a single warning when mock mode is active.

1. `extractPassport(imageOrPdf)`: `generateObject` with an image part (or extracted PDF text) and a Zod schema of passport fields + `confidence` (0–1) per field + `warnings[]`. System prompt: act as a careful passport data-entry clerk; transcribe exactly; use ISO dates; return null for unreadable fields; never guess a passport number.
2. `verifyDocument(type, text | image, context)`: `generateObject` with the destination's rule for that document type and the traveller's passport name/dates in the prompt. Schema: `{ matchesExpectedType: boolean, extracted: Record<string, string|number|null>, issues: string[], verdict: 'ok'|'warning'|'fail' }`. Deterministic post-checks in `src/lib/rules.ts` may upgrade `warning` → `fail` (e.g. dates inconsistent with travel dates).
3. `readinessNarrative(ruleResults, destination)`: `generateText`, 80–120 words, plain language, ends with the fixed disclaimer sentence. Score itself is **deterministic** (`src/lib/scoring.ts`): start at 100; −25 per missing required doc; −20 per `fail`; −8 per `warning`; −30 if passport validity rule fails; clamp 0–100; bands: ≥80 Strong, 55–79 Needs work, <55 Weak.
4. `quizNarrative(answers, score)`: same pattern as 3.

Prompts live in `src/lib/prompts.ts`. Never send the raw file bytes to the LLM for PDFs — send extracted text (truncated to ~12k chars). Images are sent as image parts (base64), max 5 MB per upload.

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real LLM calls; leave empty to run in mock mode
LLM_MODEL=claude-sonnet-4-5   # any Anthropic model id supported by @ai-sdk/anthropic
MOCK_LLM=                     # set to 1 to force deterministic canned LLM output (used by smoke tests)
DATABASE_URL=file:./data/visa.db
UPLOAD_DIR=./data/uploads
MAX_UPLOAD_MB=5
```

## What to skip

- Authentication, accounts, billing/payments, admin panel, email/WhatsApp notifications.
- Real appointment booking or any automation against VFS/embassy sites (show a stub card with "Book appointment — coming soon" and the official-channel advice).
- Official government PDF forms (generate our own layout instead).
- Multi-language UI (English only), i18n, analytics.
- Deployment config beyond `npm run build && npm start`.

## Acceptance checks (the build must pass all of these; run them and paste the output in the report)

1. `npm install` completes; `npm run build` exits 0 with no TypeScript errors.
2. `MOCK_LLM=1 npm run dev` (or `npm start` after build) boots; `curl -s localhost:3000/` returns 200 and contains the word "destination".
3. `curl -s -X POST localhost:3000/api/applications -H 'content-type: application/json' -d '{"destinationCode":"HR","nationality":"EG","purpose":"tourism","departureDate":"2026-12-10","returnDate":"2026-12-20","travellerCount":1}'` returns 201 with an `id`, and `GET /api/applications/<id>` lists ≥ 6 required document types for Croatia.
4. Uploading a sample passport image (generate a simple PNG with text in `scripts/` or use any placeholder image) to `POST /api/applications/<id>/travellers` in mock mode returns structured passport fields with `confidence` values, and the traveller appears on `GET /api/applications/<id>`.
5. Uploading a sample PDF (generate one with pdfkit in a script, e.g. a fake bank statement) as `type=bank_statement` returns a verification object with a `verdict`, and the readiness endpoint returns a numeric `score` 0–100 with a `band` and a `narrative`.
6. `GET /api/applications/<id>/travellers/<tid>/form.pdf` returns `content-type: application/pdf`, starts with `%PDF`, and when text is extracted with pdf-parse it contains the traveller's surname.
7. `POST /api/quiz` with a sample answers payload returns a score and narrative.
8. Provide `scripts/smoke.sh` (or `npm run smoke`) that runs checks 2–7 against a running server in mock mode and prints PASS/FAIL per check. All PASS.
9. `.env.example` and `.gitignore` exist; `git status` shows no `node_modules`, `.next`, `data/` or `.env` files.

## Assumptions (record these in README)

- Destination requirements, fees and scoring weights are illustrative, written for this clone, and are not Veeza's or any embassy's official data.
- Passport extraction accuracy depends on the vision model; the clone always shows an editable form and never auto-submits anything.
- Mock mode is for development and tests; it returns the same canned passport/verification for every upload.
