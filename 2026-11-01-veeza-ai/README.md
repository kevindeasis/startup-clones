# Visa Copilot - a clone of Veeza AI (YC F26)

Part of the "one startup clone a day" project (2026-11-01).

## The original company

[Veeza AI](https://veeza.ai) ([YC profile](https://www.ycombinator.com/companies/veeza-ai)) is an AI-assisted tourist-visa service for travellers with "weak" passports, starting with Egyptian passport holders. Its public pitch is "Tell us the destination. We'll apply for your visa." As publicly described: you pick a destination at a per-person package price, upload a passport and answer a few questions so the forms get pre-filled, supporting documents are checked by AI, a public quiz estimates how strong your application is ("a guide, never a visa decision"), a human visa expert reviews the prepared application, and on full-service packages the team books the appointment. This README makes no claims about Veeza's internal technology, pricing or metrics.

## What this clone does

Steps 1-4 of that flow as a self-serve web app:

1. **Start an application** - destination (10 seeded), nationality, dates, purpose, 1-5 travellers; shows the document checklist and an illustrative service fee.
2. **Passport extraction** - upload JPEG/PNG/PDF per traveller; an LLM extracts structured fields with per-field confidence; editable form; passport validity rules run immediately.
3. **Document checklist + AI verification** - upload each required document; text is extracted (PDF via `pdf-parse`, images via LLM vision); the LLM returns `{matchesExpectedType, extracted, issues, verdict}`; deterministic checks (itinerary/hotel dates vs travel dates, bank statement months, insurance cover, name vs passport) can upgrade the verdict.
4. **Readiness score** - deterministic 0-100 score plus an LLM-written narrative and top 3 fixes, with the "A guide, never a visa decision." disclaimer.
5. **Form pre-fill + review** - downloadable pre-filled PDF per traveller (own layout, built with `pdfkit`), review page with summary, status timeline and a "Request correction" notes box.
6. **Public quiz** at `/quiz` - 7 questions, deterministic score + narrative, nothing persisted.

## What it skips (stubbed or absent)

Authentication/accounts, payments, a human expert marketplace (timeline step "Expert review" is a stub), real appointment booking (a "Book appointment - coming soon" card with advice to use official channels), WhatsApp/email notifications, official government PDF forms, i18n, analytics, any automation against VFS/embassy sites.

## Architecture

```
Next.js 16 App Router (UI + API routes)
  src/app/                pages: /, /apply/new, /apply/[id], /quiz
  src/app/api/            REST routes (applications, travellers, documents, readiness, form.pdf, notes, status, quiz)
  src/components/         client components (Workspace tabs, new-application form, quiz)
  src/lib/destinations.ts static catalogue (illustrative requirements + fees)
  src/lib/llm.ts          all LLM access (Vercel AI SDK) + deterministic mock mode
  src/lib/prompts.ts      prompts
  src/lib/rules.ts        passport validity + document consistency checks + missing-doc detection
  src/lib/scoring.ts      deterministic score + bands + top fixes
  src/lib/quiz.ts         quiz questions + scoring
  src/lib/pdfform.ts      pdfkit form generator
  src/lib/schema.ts, db.ts, repo.ts   Drizzle schema, libsql client (auto-creates tables), repository
  src/lib/storage.ts      uploads to ./data/uploads/<applicationId>/
```

Score rule: start at 100; -25 per missing required document (one penalty per document type); -20 per failed document; -8 per warning; -30 once if a passport validity rule fails; clamp 0-100. Bands: >=80 Strong, 55-79 Needs work, <55 Weak. The LLM never influences the number.

SQLite driver used: **`@libsql/client`** (with Drizzle ORM), writing `./data/visa.db`. It installed and ran natively in this environment, so the `better-sqlite3` and JSON-store fallbacks were not needed.

Deprecation note: `ai@7` marks `generateObject` as deprecated in favour of `generateText` with `output`; the spec asked for `generateObject`, which still works and type-checks. Migrating is a small change in `src/lib/llm.ts`.

## GitHub tools used

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

## Setup and run

Requires Node 22.

```bash
cd 2026-11-01-veeza-ai
npm install
cp .env.example .env        # optional; leave ANTHROPIC_API_KEY empty for mock mode
npm run build               # type-checks and builds
MOCK_LLM=1 npm start        # or: MOCK_LLM=1 npm run dev   -> http://localhost:3000
npm run smoke               # in another terminal; runs acceptance checks 2-7 against the server
```

`scripts/make-samples.mjs` generates a placeholder PNG passport and a PDF bank statement; `scripts/pdftext.mjs` prints PDF text via pdf-parse (used by the smoke test).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Real LLM calls. Empty => mock mode |
| `LLM_MODEL` | `claude-sonnet-4-5` | Any Anthropic model id supported by `@ai-sdk/anthropic` |
| `MOCK_LLM` | empty | `1` forces deterministic canned output |
| `DATABASE_URL` | `file:./data/visa.db` | libsql URL |
| `UPLOAD_DIR` | `./data/uploads` | Upload storage |
| `MAX_UPLOAD_MB` | `5` | Per-file upload limit |

Note: Next.js loads `.env` automatically. A set `MOCK_LLM=1` or a missing key logs one warning and uses mock mode.

## Known limitations

- The real-LLM code path (vision passport extraction, document verification, narratives) is fully written and type-checked but was **never run against the live API** because no `ANTHROPIC_API_KEY` was available during the build. Treat it as untested.
- Mock mode returns the same canned passport/verification for every upload (verification dates follow the application's dates, so mock results are consistent).
- Scanned PDFs with no text layer produce empty text; PDFs are never sent as images or raw bytes to the model.
- Passport PDFs use extracted text only; MRZ checksum validation is not implemented.
- Missing-document penalties are per document type, not per traveller; a fresh application scores 0 until documents are added (by design of the spec's weights).
- No auth: anyone with an application URL (a UUID) can view it. Do not use with real personal data.
- Destination requirements, fees and scoring weights are illustrative.
- `data/` (SQLite file and uploads) is local disk only.

## Assumptions

- Destination requirements, fees and scoring weights are illustrative, written for this clone, and are not Veeza's or any embassy's official data.
- Passport extraction accuracy depends on the vision model; the clone always shows an editable form and never auto-submits anything.
- Mock mode is for development and tests; it returns the same canned passport/verification for every upload.

## Next 3 things to build

1. Run and tune the real LLM path with a key: evaluate passport extraction on real specimen images, add MRZ checksum validation, and migrate from deprecated `generateObject` to `generateText` with structured output.
2. Per-traveller/shared-document UX: multi-page documents, re-verification when a passport is edited, and a document-by-document "what to fix" view.
3. Human-in-the-loop review: a reviewer view with accept/request-correction actions that drive the Expert review status, plus accounts so applications are private.
