# ClaimCheck - a clone of Cesara

ClaimCheck is a local, end-to-end clone of the core loop of **[Cesara](https://cesara.com)** (YC Fall 2026): read a payer contract, compute what every claim *should* have paid, flag underpayments with the clause that proves it, and draft the appeal.

- Original company: https://cesara.com
- YC launch post: https://www.ycombinator.com/launches/WBc-cesara-ai-agents-that-make-sure-every-healthcare-transaction-is-paid-per-contract

## What Cesara does (the original)

Cesara sells AI agents to health-system revenue-cycle and managed-care teams that make sure every healthcare claim is paid per the payer contract. Per its launch post it (1) extracts rates, carve-outs, stop-loss terms and rate increases from payer contracts and keeps them in sync, (2) computes the expected payment per claim and flags shortfalls with the relevant clause (example: a payer paid $42,000 where the stop-loss clause implied $78,000), (3) files appeals with the contract excerpt and the 835 remittance attached and tracks them to recovery, and (4) lets teams query contracts in plain language and model proposed rates before signing. It integrates with Epic, Waystar, Availity, Teams and Slack.

## What this clone does

1. **Contract ingestion** - upload a PDF or paste text/markdown; an LLM extracts a structured `ContractTerms` object (fee schedule, case rates, per-diems, carve-outs, stop-loss, escalator, default rule, admin terms), each with a verbatim `source_clause`.
2. **Claims check** - upload a simplified 835-like CSV; a **deterministic pricing engine** (no LLM) computes expected payment per claim and flags `underpaid` / `overpaid` / `ok` / `no_rate_found`, with a plain-English reason and the clause id used.
3. **Underpayment queue** - tiles (claims checked, underpaid count, $ underpaid, $ recovered) and a status workflow: open, appealed, recovered, closed.
4. **Appeal letters** - one click drafts an appeal letter citing the clause and the remittance facts; copy it, mark appealed/recovered.
5. **Ask the contract** - streamed chat grounded in the contract text and extracted terms.
6. **What-if rates** - change one rate / percent / threshold and see recomputed totals over the loaded claims (not persisted).

### Skipped on purpose

Auth, billing, multi-tenant, Epic/Waystar/Availity/Slack/Teams integrations, real X12 835 parsing (CSV with 835-like columns instead), automated filing of appeals, OCR of scanned PDFs.

## Architecture

```
Next.js 16 (App Router, src/)  --  UI pages + route handlers in one project
  src/app/page.tsx                    contracts list + "New contract"
  src/app/contracts/[id]/page.tsx     tabs: Terms | Claims | Underpayments | Ask | What-if
  src/app/claims/[rowId]/page.tsx     claim detail, appeal letter, status buttons
  src/app/api/...                     REST endpoints (see below)
  src/components/                     client components (tabs, new-contract form, claim actions)
  src/lib/pricing.ts                  deterministic pricing engine (pure, unit-tested)
  src/lib/llm.ts                      ALL LLM calls + mock mode (generateObject / generateText / streamText)
  src/lib/prompts.ts                  system prompts and prompt builders
  src/lib/sample.ts                   SAMPLE_TERMS (canned extraction of the sample contract)
  src/lib/repo.ts, db.ts              better-sqlite3 data access; schema in schema.sql
  src/lib/types.ts                    zod schemas (ContractTerms, claim rows)
data/sample-contract.md, data/sample-claims.csv   fictional sample data
scripts/smoke.sh                      end-to-end acceptance checks A3-A11
```

The LLM only does *language* work (extract terms, write letters, answer questions). Every dollar figure comes from `pricing.ts`, so results are auditable. Pricing rules: term lookup order carve-out, case rate, per-diem, fee schedule, percent-of-charges; stop-loss on case rates when billed charges exceed the threshold; escalator on rate-based amounts on/after its effective date; default rule for unlisted codes; flag when |variance| >= max($25, 1% of expected).

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | `{ ok, mock }` |
| `POST /api/contracts` | multipart `file` or JSON `{text,name?}` or `{sample:true}` (`?sample=1`) -> `{id,payer,terms_count}` |
| `GET /api/contracts`, `GET /api/contracts/[id]` | list / detail with terms and claim summary |
| `POST /api/contracts/[id]/claims` | multipart CSV `file` or `{sample:true}`; parses, prices, replaces claims |
| `GET /api/contracts/[id]/claims?flag=underpaid` | rows |
| `GET/PATCH /api/claims/[rowId]` | row + clause; `{status}` update |
| `POST /api/claims/[rowId]/appeal` | `{letter}` (stored in `appeals`) |
| `POST /api/contracts/[id]/ask` | `{messages:[{role,content}]}` -> streamed text |
| `POST /api/contracts/[id]/whatif` | `{term_id,rate?,percent?,threshold?}` -> before/after totals |

## GitHub tools used

- [vercel/next.js](https://github.com/vercel/next.js) - Next.js 16 App Router, UI and API routes
- [vercel/ai](https://github.com/vercel/ai) - Vercel AI SDK v7 (`ai`) with `@ai-sdk/anthropic`: `generateObject`, `generateText`, `streamText`
- [colinhacks/zod](https://github.com/colinhacks/zod) - schemas
- [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - local SQLite
- [mholt/PapaParse](https://github.com/mholt/PapaParse) - CSV parsing
- [unjs/unpdf](https://github.com/unjs/unpdf) - PDF text extraction
- [ai/nanoid](https://github.com/ai/nanoid) - ids
- [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) - Tailwind v4 styling
- [privatenumber/tsx](https://github.com/privatenumber/tsx) with Node's built-in `node:test` - tests

## Setup and run

Requires Node 22+.

```bash
npm install
cp .env.example .env.local        # then edit; leave ANTHROPIC_API_KEY empty for mock mode
npm run dev                       # http://localhost:3000
# production:
npm run build
MOCK_LLM=1 npm run start          # or without MOCK_LLM when ANTHROPIC_API_KEY is set
```

Then open http://localhost:3000, click **Load sample contract**, open **Claims** and **Load sample claims**.

Other scripts: `npm test` (pricing unit tests, 16 cases), `npm run lint`, and `npm run smoke` (runs `scripts/smoke.sh` against a running server; set `BASE=http://localhost:PORT` for another port).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (empty) | Required for real LLM output. Never commit it. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model id used for all calls |
| `MOCK_LLM` | (empty) | `1` forces mock mode (also auto-on when there is no API key) |
| `DATABASE_PATH` | `./data/claimcheck.db` | SQLite file; tables are created on first run from `schema.sql` |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` | Base URL (informational) |

## Mock mode

`isMock()` in `src/lib/llm.ts` is `process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY`; one warning is logged when it first activates. In mock mode:

- **Extraction** returns the canned `SAMPLE_TERMS` (which exactly describes `data/sample-contract.md`, with verbatim clauses - a unit test enforces that) regardless of the uploaded text.
- **Appeal letters** come from a template filled with the claim facts, computation and clause.
- **Ask** does keyword lookup over the extracted terms (stop-loss/outlier, escalator, carve-out, per diem, default, timely filing, appeals, or a code number) and quotes the clause; otherwise it returns the most relevant clause by word overlap, or "That is not in the contract."

The real path (`generateObject` with the `ContractTerms` zod schema, `generateText` for letters, `streamText(...).toTextStreamResponse()` for Ask, all through `@ai-sdk/anthropic`) type-checks and builds but has **not** been exercised here because no `ANTHROPIC_API_KEY` was available.

## Verification performed

`npm run build` (zero TypeScript errors), `npm run lint`, `npm test` (16/16 pass), then `MOCK_LLM=1 npm run start` and `bash scripts/smoke.sh`: A3-A11 all PASS (A1/A2 are the build and test runs). With the sample data the engine yields 7 underpaid ($35,961.00 total), 1 overpaid, 6 ok.

## Known limitations

- Mock extraction ignores uploaded text and always returns the sample terms; real extraction quality depends on the LLM and has not been tested against a live key.
- Scanned (image) PDFs are not supported (no OCR). Contract text is truncated (~60k chars for extraction, ~40k for Ask).
- Single-user, no auth; the claims upload replaces a contract's previous claims (and their statuses/appeals).
- Pricing handles only the term types in the spec (no multi-procedure discounting, lesser-of logic, modifiers, or date-ranged rate tables). Stop-loss terms with no `applies_to` are treated as applicable.
- Ask chat is stateless on the server beyond the messages the browser sends.
- Appeals are drafted, not filed; no deadline tracking beyond showing the appeal window.

## Assumptions and notes

- Real Cesara parses X12 835s and syncs with Epic/contract-management systems; the clone uses a CSV with 835-like columns.
- Contract-term extraction quality depends on the LLM; the pricing engine is deterministic so results are auditable.
- Mock mode exists so the app can be demoed and tested with no API key; the real Anthropic path is exercised only when `ANTHROPIC_API_KEY` is set.
- Not legal, billing or compliance advice; sample contract and claims are fictional.

## Next 3 things to build

1. Real X12 835 (and 837) parsing, so remittances load without CSV massaging and CARC/RARC denial codes feed the reason text.
2. Appeal tracking: deadline countdowns from the contract's appeal window, reminders, attachment bundling (clause excerpt + remittance PDF) and recovery reconciliation against later remittances.
3. Contract versioning and amendment diffing, with evaluation of LLM extraction against a labelled contract set (and human-in-the-loop edits to extracted terms before pricing).
