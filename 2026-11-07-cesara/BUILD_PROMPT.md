# BUILD_PROMPT.md — 2026-11-07 Cesara clone (ClaimCheck)

Every prompt sent to the Sonnet build subagent, verbatim and in order.

## Round 1 — initial build prompt (Agent tool, subagent_type general-purpose, model sonnet)

```markdown
You are a senior full-stack engineer. Build a working end-to-end clone of the YC startup Cesara, called "ClaimCheck", inside the folder `/home/claude/startup-clone/2026-11-07-cesara/` exactly per the spec below (the spec already exists at `/home/claude/startup-clone/2026-11-07-cesara/SPEC.md`; do not modify it).

Rules:
- Build the working end-to-end clone inside `/home/claude/startup-clone/2026-11-07-cesara/` exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (Next.js 16, Vercel AI SDK v7 `ai` + `@ai-sdk/anthropic`, zod, better-sqlite3, papaparse, unpdf, nanoid, Tailwind v4, tsx + node:test) instead of reinventing them. Versions verified on npm today: ai 7.0.165, @ai-sdk/anthropic 4.0.99, next 16.4.5, better-sqlite3 13.0.3, papaparse 5.7.0, unpdf 2.1.0, zod 4.6.7; Node 22 is installed. Scaffold with `npx create-next-app@latest . --ts --app --src-dir --tailwind --eslint --no-import-alias --use-npm --yes` (or equivalent) and then add the dependencies; if the scaffold complains about existing files (SPEC.md etc.), scaffold into a temp dir and move the files in.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO `ANTHROPIC_API_KEY` in this environment, so everything must be verified in mock mode (`MOCK_LLM=1`), and the real Anthropic code path must still type-check and be wired exactly as the spec says.
- Add a `.gitignore` appropriate for the stack (node_modules, .next, .env*, data/*.db, coverage, *.tsbuildinfo).
- Verify it: install dependencies, run `npm run build`, run `npm test`, then start the app in production mode (`MOCK_LLM=1 npm run start` on port 3000, or another free port) and run `scripts/smoke.sh` against it to confirm it boots and every acceptance check A1–A11 in the spec passes. Fix errors before finishing. Do not claim it works unless you actually ran it. Kill any server you started when you are done.
- Write a thorough `README.md` in the folder: what the original company does (with link to https://cesara.com and the YC launch post https://www.ycombinator.com/launches/WBc-cesara-ai-agents-that-make-sure-every-healthcare-transaction-is-paid-per-contract), what this clone does and what it skips, architecture summary, the GitHub tools used (with links to their repos), exact setup and run steps, environment variables, how mock mode works, known limitations, the assumptions listed in spec §12, and the next 3 things to build.
- Do not modify anything outside `/home/claude/startup-clone/2026-11-07-cesara/`. Do not touch SPEC.md, BUILD_PROMPT.md or BUILD_LOG.md in that folder. Do not run git commands (no commit, no push).
- Report back at the end: what was built (file tree summary), exactly which verification commands were run and their results (paste the PASS/FAIL lines from the smoke script and the test summary), anything that does not work or was left out, and your best estimate of your total input and output token usage.

================ SPEC.md (verbatim) ================

# SPEC — "ClaimCheck": a clone of Cesara (YC F26)

Date: 2026-11-07. Folder: `2026-11-07-cesara/`. App name: **ClaimCheck**.

## 0. What the original product does

[Cesara](https://cesara.com) (YC Fall 2026, launched on YC Launches 2026-10-22) sells AI agents to health-system revenue-cycle and managed-care teams that make sure every healthcare claim is paid per the payer contract. Per their launch post, it (1) extracts rates, carve-outs, stop-loss terms and rate increases from payer contracts and keeps them in sync, (2) computes the expected payment for each claim and flags shortfalls with the relevant contract clause (their example: a payer paid $42,000 where the stop-loss clause implied $78,000), (3) files appeals with the contract excerpt and the 835 remittance attached and tracks them to recovery, and (4) lets teams query contracts in plain language and model proposed rates before signing. Integrations: Epic, Waystar, Availity, Teams, Slack. Health systems pay for it (recovered underpayments).

## 1. What the clone does (scope)

ClaimCheck is a local web app that reproduces the core loop without any EHR/clearinghouse integrations:

1. **Contract ingestion** — upload a payer contract (PDF or pasted text/markdown). An LLM extracts a structured `ContractTerms` object (fee schedule, case rates, per-diems, carve-outs, stop-loss, escalators, default payment rule, admin terms) with a verbatim source clause for every term. The user reviews the terms table.
2. **Claims check** — upload a simplified 835/claims CSV. A **deterministic pricing engine** (no LLM) computes the expected payment for each claim from the extracted terms, compares with the paid amount, and flags underpayments with the clause that justifies the expected amount.
3. **Underpayment queue** — dashboard of flagged claims (expected vs paid, variance, reason, clause), totals, and a status workflow (open → appealed → recovered / closed).
4. **Appeal letters** — one click drafts an appeal letter (LLM) that cites the contract clause and the remittance facts; the user can copy it and mark the claim appealed/recovered.
5. **Ask the contract** — a chat box that answers plain-language questions about the contract (streamed, grounded in the contract text + extracted terms).
6. **What-if rates** — change one rate (or the stop-loss threshold/percentage) and see the recomputed totals over the loaded claims — a mini version of "model proposed rates before signing".

Skip: auth, billing, multi-tenant, Epic/Waystar/Availity/Slack/Teams integrations, real X12 835 parsing (we use a CSV with 835-like columns), automated filing of appeals, OCR of scanned PDFs.

## 2. Stack (fixed)

- **Next.js 16 (App Router) + TypeScript + React 19 + Tailwind CSS v4** — UI and API routes in one project (`npx create-next-app@latest` style layout, `src/` dir).
- **Vercel AI SDK v7** (`ai`) + **`@ai-sdk/anthropic`** — `generateObject` for structured contract extraction and appeal-letter generation, `streamText` for the Ask chat. Default model `claude-sonnet-5-5`, overridable via `ANTHROPIC_MODEL`.
- **zod** — schemas for `ContractTerms`, claims rows, API bodies.
- **better-sqlite3** — local SQLite database at `DATABASE_PATH` (default `./data/claimcheck.db`), tables created on first run (plain SQL in `schema.sql`; no ORM needed).
- **papaparse** — CSV parsing of the claims file.
- **unpdf** — text extraction from uploaded PDF contracts (serverless-friendly pdf.js build). Text/markdown uploads bypass it.
- **nanoid** — ids.
- Tests: Node's built-in `node:test` + `tsx` (dev dep) for the pricing engine. Smoke test: `scripts/smoke.sh` (bash + curl + node for JSON checks).

Verified on npm today: ai 7.0.165, @ai-sdk/anthropic 4.0.99, next 16.4.5, better-sqlite3 13.0.3, papaparse 5.7.0, unpdf 2.1.0, zod 4.6.7. Node 22 is available.

## 3. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real LLM output
ANTHROPIC_MODEL=claude-sonnet-5-5
MOCK_LLM=                     # set to 1 to force deterministic mock mode (also auto-on when no API key)
DATABASE_PATH=./data/claimcheck.db
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

**Mock mode is mandatory and must make the whole app work end to end without a key.** All LLM calls live in one module `src/lib/llm.ts` with `isMock()` exactly like: `process.env.MOCK_LLM === "1" || !process.env.ANTHROPIC_API_KEY`. In mock mode: contract extraction returns the canned `SAMPLE_TERMS` object (which must exactly describe the bundled sample contract — see §6); appeal letters are produced from a template filled with the claim's facts; the Ask chat does keyword lookup over the extracted terms (e.g. a question containing "stop-loss"/"stop loss"/"outlier" answers with the threshold and percentage and quotes the clause) and otherwise returns the most relevant clause by simple word overlap. Log one warning when mock mode activates.

## 4. Data model (SQLite)

```sql
contracts(id TEXT PK, payer TEXT, name TEXT, source_text TEXT, terms_json TEXT, created_at TEXT)
claims(id TEXT PK, contract_id TEXT FK, claim_id TEXT, patient_ref TEXT, service_date TEXT,
       code_type TEXT,  -- 'DRG' | 'CPT' | 'REV'
       code TEXT, description TEXT, units REAL, billed_charges REAL, paid_amount REAL,
       expected_amount REAL NULL, variance REAL NULL,   -- variance = expected - paid
       flag TEXT,      -- 'underpaid' | 'overpaid' | 'ok' | 'no_rate_found'
       reason TEXT,    -- human-readable explanation of the computation
       clause_ref TEXT, -- id of the term used (fee schedule entry / stop-loss / default)
       status TEXT,    -- 'open' | 'appealed' | 'recovered' | 'closed'
       created_at TEXT)
appeals(id TEXT PK, claim_row_id TEXT FK, letter_text TEXT, created_at TEXT)
```

### `ContractTerms` (zod schema, stored as `terms_json`)

```ts
{
  payer: string; provider: string; contract_name: string;
  effective_date: string; end_date?: string;
  terms: Array<{
    id: string;                       // stable id, e.g. "fs-99213", "drg-470", "stoploss-1", "carveout-0278", "default-1", "escalator-1"
    kind: "fee_schedule" | "case_rate" | "per_diem" | "percent_of_charges" | "carve_out" | "stop_loss" | "escalator" | "default_rule" | "admin";
    code_type?: "CPT" | "DRG" | "REV";
    code?: string;                    // exact code this term applies to (for fee_schedule/case_rate/per_diem/carve_out)
    description?: string;
    rate?: number;                    // dollars for flat/case/per-diem terms
    percent?: number;                 // 0–100 for percent_of_charges / carve_out / stop_loss / escalator / default_rule
    threshold?: number;               // dollars, stop_loss only
    applies_to?: "inpatient" | "outpatient" | "all";
    effective_from?: string;          // escalator only (ISO date)
    source_clause: string;            // verbatim excerpt from the contract (≤ 400 chars)
  }>;
  admin: { timely_filing_days?: number; appeal_window_days?: number; notes?: string };
}
```

## 5. Pricing engine (deterministic, `src/lib/pricing.ts`) — exact rules

Input: one claim row + `ContractTerms`. Output: `{ expected: number|null, flag, reason, clause_ref }`.

1. **Term lookup order** for the claim's `(code_type, code)`: `carve_out` → `case_rate` → `per_diem` → `fee_schedule` → `percent_of_charges`. First match wins.
2. **Base expected**:
   - `fee_schedule` (flat): `rate × units`.
   - `per_diem`: `rate × units` (units = days).
   - `case_rate` (DRG): `rate` (units ignored).
   - `percent_of_charges` or `carve_out` with `percent`: `percent/100 × billed_charges`.
3. **Stop-loss** (only when the matched term is `case_rate` and a `stop_loss` term exists whose `applies_to` is `inpatient` or `all`): if `billed_charges > threshold` then `expected = case_rate + percent/100 × (billed_charges − threshold)`. The `clause_ref` becomes the stop-loss term id and the reason explains both numbers.
4. **Escalator**: if an `escalator` term exists and `service_date >= effective_from`, multiply any *rate-based* expected (steps 2 flat/per-diem/case, and the case-rate part of step 3) by `(1 + percent/100)`. Percent-of-charges amounts are not escalated.
5. **No match**: if a `default_rule` term exists, `expected = percent/100 × billed_charges` with `clause_ref` = default rule; otherwise `expected = null`, `flag = "no_rate_found"`.
6. **Flagging**: `variance = round2(expected − paid)`. `underpaid` if `variance ≥ max(25, 0.01 × expected)`; `overpaid` if `variance ≤ −max(25, 0.01 × expected)`; else `ok`.
7. Round money to cents. Reason strings must be plain English, e.g. `"DRG 470 case rate $24,500.00; billed charges $160,000.00 exceed stop-loss threshold $100,000.00 → + 70% × $60,000.00 = $66,500.00 expected; paid $42,000.00; underpaid by $24,500.00."`

Unit tests (`src/lib/pricing.test.ts`, run with `npm test`): at least these cases — flat fee schedule ok; flat fee schedule underpaid; per-diem × days; case rate without stop-loss; case rate with stop-loss (the $66,500 example); carve-out percent; escalator applied after effective date and not before; default rule for unknown code; no_rate_found when no default; overpaid.

## 6. Bundled sample data (`data/`)

`data/sample-contract.md` — a realistic fictional agreement "Blue Harbor Health Plan — Commercial PPO Participating Hospital Agreement with Riverside Medical Center", effective 2026-01-01, containing these terms, each in its own numbered clause so a verbatim `source_clause` exists:
- Inpatient case rates: DRG 470 (major joint replacement) $24,500; DRG 291 (heart failure & shock w MCC) $11,200; DRG 871 (sepsis w MCC) $14,800.
- Stop-loss / outlier: inpatient claims whose billed charges exceed **$100,000** are paid the case rate **plus 70%** of billed charges above $100,000.
- Per-diem: behavioral health inpatient, revenue code 0124, **$1,350 per day**.
- Outpatient fee schedule (CPT): 99213 $125; 99214 $185; 70450 $410; 73721 $780; 45378 $950; 29881 $3,200.
- Carve-out: implants, revenue code 0278, paid at **65% of billed charges**.
- Escalator: all rates increase **3%** for dates of service on or after **2026-07-01**.
- Default rule: covered services not otherwise listed are paid at **55% of billed charges**.
- Admin: timely filing 90 days; appeals within 180 days of remittance.

`data/sample-claims.csv` — columns `claim_id,patient_ref,service_date,code_type,code,description,units,billed_charges,paid_amount`, 14 rows designed so the engine yields: at least 1 stop-loss underpayment (DRG 470, charges 160,000, paid 42,000 → expected 66,500), 1 case-rate underpayment without stop-loss, 1 per-diem underpayment (fewer days paid), 2 fee-schedule underpayments (one of them after 2026-07-01 so the escalator matters), 1 carve-out underpayment, 1 overpayment, 1 unknown code priced by the default rule, and ≥5 correctly paid claims. The subagent must compute the paid amounts by hand so the expected flags come out exactly, and the smoke test asserts them.

`SAMPLE_TERMS` in `src/lib/sample.ts` must be the exact `ContractTerms` for this contract (used by mock mode and by tests).

## 7. Screens

- `/` — list of contracts + "New contract" card: drop a PDF or paste text, plus a "Load sample contract" button. Shows per-contract: payer, #terms, #claims, total underpaid $.
- `/contracts/[id]` — header (payer, provider, effective date), tabs:
  - **Terms**: table of extracted terms (kind, code, rate/percent, threshold, applies to); click a row to see the verbatim clause.
  - **Claims**: upload CSV (or "Load sample claims"); table with claim id, date, code, billed, expected, paid, variance, flag; filters: all / underpaid / overpaid / no rate.
  - **Underpayments**: summary tiles (claims checked, underpaid count, total $ underpaid, $ recovered), queue of underpaid claims with status chips and links to detail.
  - **Ask**: chat UI (streaming) over this contract.
  - **What-if**: pick a term (code) and enter a new rate/percent/threshold → shows old vs new total expected over the loaded claims and the delta.
- `/claims/[rowId]` — claim detail: computed reason, clause excerpt, paid vs expected, "Draft appeal letter" button → letter shown in a textarea with Copy; status buttons (Mark appealed / Mark recovered / Close).

Plain, clean Tailwind styling; no component library required. Must render without console errors.

## 8. API endpoints (App Router route handlers under `src/app/api/`)

- `GET /api/health` → `{ ok: true, mock: boolean }`
- `POST /api/contracts` — multipart (`file`) or JSON (`{ text, name? }`) → extracts terms → `{ id, payer, terms_count }`. `?sample=1` (or JSON `{ sample: true }`) loads `data/sample-contract.md`.
- `GET /api/contracts` → list with counts; `GET /api/contracts/[id]` → contract + terms + claim summary.
- `POST /api/contracts/[id]/claims` — multipart CSV (`file`) or `{ sample: true }` → parses, prices, replaces that contract's claims → `{ total, underpaid, overpaid, ok, no_rate_found, total_underpaid_amount, rows: [...] }`.
- `GET /api/contracts/[id]/claims?flag=underpaid` → rows.
- `GET /api/claims/[rowId]` → row + contract clause; `PATCH /api/claims/[rowId]` `{ status }`.
- `POST /api/claims/[rowId]/appeal` → `{ letter }` (also stored in `appeals`).
- `POST /api/contracts/[id]/ask` `{ messages: [{role, content}] }` → streamed text (AI SDK `streamText(...).toTextStreamResponse()`; in mock mode return a plain text Response).
- `POST /api/contracts/[id]/whatif` `{ term_id, rate?, percent?, threshold? }` → `{ before_total, after_total, delta, changed_claims }` (does not persist).

## 9. LLM prompts / pipeline (`src/lib/prompts.ts`, `src/lib/llm.ts`)

- **Extraction**: system prompt = "You are a managed-care contract analyst…"; instruct to output every payment term as a separate item with the exact code, dollar/percent values as numbers, and a verbatim `source_clause`; never invent terms; use `applies_to`. Use `generateObject` with the `ContractTerms` zod schema. Truncate contract text to ~60k chars. Post-process: dedupe term ids, coerce codes to strings.
- **Appeal letter**: `generateText` with the claim facts, the computed reason, the clause excerpt and admin terms; output a formal letter (≈250–350 words) with subject line, claim identifiers, the expected vs paid computation, the clause quoted, a request for reprocessing within the appeal window, and a placeholder signature block. No made-up patient PHI beyond the `patient_ref` provided.
- **Ask**: `streamText` with system prompt containing the extracted terms as JSON and the contract text (truncated to ~40k chars); answer only from the contract, cite clause numbers, say "not in the contract" if absent.

## 10. Files & scripts

- `README.md` (thorough, see task instructions), `.env.example`, `.gitignore` (node_modules, .next, .env*, data/*.db, coverage), `schema.sql`, `data/sample-contract.md`, `data/sample-claims.csv`, `scripts/smoke.sh`.
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `test` (`tsx --test src/lib/*.test.ts`), `smoke` (`bash scripts/smoke.sh`).
- Keep everything inside this folder. Do not commit or push.

## 11. Acceptance checks (all must pass; the smoke script prints `PASS <id>` / `FAIL <id>` lines)

- **A1** `npm install` and `npm run build` complete with zero TypeScript errors.
- **A2** `npm test` passes (≥10 pricing cases from §5).
- **A3** `MOCK_LLM=1 npm run start` → `GET /` returns 200 and `GET /api/health` returns `{ok:true, mock:true}`.
- **A4** `POST /api/contracts` with `{sample:true}` → 200; stored terms include ≥9 fee-schedule/case-rate/per-diem/carve-out terms, exactly one `stop_loss` term with threshold 100000 and percent 70, one `escalator`, one `default_rule`.
- **A5** `POST /api/contracts/{id}/claims` with `{sample:true}` → `total` = 14, `underpaid` ≥ 6, `overpaid` = 1, `no_rate_found` = 0, and the DRG 470 claim has `expected_amount` = 66500 and `variance` = 24500 with `clause_ref` = the stop-loss term id.
- **A6** Correctly paid sample claims have `flag = "ok"` and `variance` within ±25.
- **A7** `POST /api/claims/{rowId}/appeal` for the DRG 470 claim → letter contains the claim id, "66,500", "42,000" and the stop-loss clause text (first 40 chars of `source_clause`).
- **A8** `POST /api/contracts/{id}/ask` with "What is the stop-loss threshold?" → response text contains "100,000" (or "100000") and "70".
- **A9** `POST /api/contracts/{id}/whatif` raising DRG 470's rate to 30000 → `delta` > 0 and `changed_claims` ≥ 1.
- **A10** `PATCH /api/claims/{rowId}` `{status:"appealed"}` → subsequent GET shows `appealed`.
- **A11** The pages `/`, `/contracts/{id}`, `/claims/{rowId}` return 200 in production mode.

## 12. Assumptions and notes to record in the README

- Real Cesara parses X12 835s and syncs with Epic/contract-management systems; the clone uses a CSV with 835-like columns.
- Contract-term extraction quality depends on the LLM; the pricing engine is deterministic so results are auditable.
- Mock mode exists so the app can be demoed and tested with no API key; the real Anthropic path is exercised only when `ANTHROPIC_API_KEY` is set.
- Not legal, billing or compliance advice; sample contract and claims are fictional.
```

## Round 2 — fix prompt (sent to the same Sonnet subagent via SendMessage)

```markdown
Fix round 1 for ClaimCheck (`/home/claude/startup-clone/2026-11-07-cesara/`): Tailwind CSS is not being applied in the built app.

What I found when I reviewed your work: `npm run build`, `npm test` (16/16) and `scripts/smoke.sh` (A3–A11) all pass for me too, and a Playwright walk-through of the UI (load sample contract → Claims → load sample claims → Underpayments → Ask → What-if → claim detail → draft appeal → mark appealed) works with zero console/page errors. But every page renders completely unstyled: the compiled stylesheet `.next/static/chunks/*.css` is only 200 bytes (just the `:root`/`body` rules from `globals.css`), so none of the Tailwind utility classes exist. Cause: when you removed `cacheComponents`/`partialPrefetching` from `next.config.ts`, you also dropped the scaffold's Turbopack rule that runs the Tailwind v4 loader. The sibling project `/home/claude/startup-clone/2026-11-07-gatherhq/next.config.ts` shows the working shape:

    turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } }

Please:
1. Restore that `turbopack.rules` block in `next.config.ts` (keep `serverExternalPackages: ["better-sqlite3", "unpdf"]`), or otherwise wire Tailwind v4 the way `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md` says for this Next version.
2. Rebuild (`npm run build`) and confirm the emitted CSS chunk is now large (tens of KB) and contains utility classes such as `.max-w-6xl` and `.bg-white`.
3. Re-run `npm test` and, with `MOCK_LLM=1 DATABASE_PATH=/tmp/claude-0/-home-claude/6fac935a-0d97-548c-aa03-dacb8b5b6a8b/scratchpad/fix.db npm run start -- -p 3100`, `BASE=http://localhost:3100 bash scripts/smoke.sh`; kill the server afterwards.
4. Small cosmetic fix on `/claims/[rowId]`: the flag chip ("underpaid") runs straight into the reason text ("underpaidDRG 470 case rate…") — put a space/margin or a line break between the chip and the reason.
5. Do not touch SPEC.md, BUILD_PROMPT.md, BUILD_LOG.md; no git commands; nothing outside the folder.

Report back: the exact commands run, the CSS chunk size, the smoke PASS/FAIL lines, and your token usage estimate for this round.
```
