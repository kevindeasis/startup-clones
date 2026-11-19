# BrokerDesk — a Covera learning clone (2026-11-19)

> **Independent learning clone. Not affiliated with, endorsed by, or derived from code of Covera.**
> Carriers, the agency ("Harbor Point Insurance"), accounts and rates in this repo are entirely fictional.

## The original: Covera

Covera (YC F26, https://www.covera-agents.com, https://www.ycombinator.com/companies/covera) is an "AI-native OS for
insurance brokers". A client request arrives by email; Covera opens an opportunity, fills a risk profile from emails and
documents, keys every carrier portal (even with partial data), returns quotes side by side (premium, deductible,
coverage) and, once the broker picks one, syncs the AMS and drafts the client summary. Other agents cover submission
intake (chasing missing documents), quote comparison, day-to-day account assistance, renewals and cross-sell / account
rounding. A human approves every action; Covera never submits a quote on its own. Customers are independent P&C agencies
and captive agents writing commercial lines (BOP, GL, workers' comp, commercial auto, cyber, liquor liability).

## What this clone does

One Next.js app with five modules:

1. **Intake** (`/intake`) — paste a client email or upload `.txt` / `.pdf`; extract a structured risk profile (editable form),
   see which fields each requested line still needs, get a drafted follow-up email, save an opportunity.
2. **Quote** — "Key carrier portals": for each of 4 fictional carriers the quoting agent maps the risk profile to that
   carrier's own field schema (e.g. `insured_legal_name`, `gross_sales`, `num_fte`), POSTs it to the carrier's mock portal
   endpoint (`/api/carriers/[carrierId]/quote`) and records a per-carrier step log. Partial data is submitted anyway; the
   portal answers `quoted`, `declined` (appetite) or `needs_info`.
3. **Compare** — deterministic table (premium, deductible, limits, coverages, exclusions) with cheapest / broadest picks
   computed in code, plus an LLM (or template) recommendation and client proposal email. The broker **selects** a quote;
   nothing is ever auto-bound.
4. **Account rounding** (`/book`) — 8 seeded accounts; a rule engine flags missing lines (restaurant without liquor,
   employees without WC, e-commerce/software without cyber, plus per-industry recommended lines) and drafts outreach.
5. **Pipeline dashboard** (`/`) — opportunities by stage: `intake` -> `needs_info` -> `quoting` -> `quoted` -> `selected`.

Also: `/portal/[carrierId]` shows each carrier's field schema, appetite and rating table.

**Skipped** (as per spec): auth, billing, multi-tenant, real AMS/carrier/email integrations, browser automation,
bind/COI generation, renewals scheduler, real policy forms, WhatsApp/Gmail ingestion.

## Architecture

```
src/
  app/                    Next.js App Router (pages + API routes)
    page.tsx              pipeline dashboard (server component)
    intake/               intake form (client)
    opportunities/[id]/   opportunity detail: quote, compare, select (client)
    book/                 book of business + gaps (client)
    portal/[carrierId]/   human-readable carrier portal page
    api/extract           email/PDF -> profile + missing + follow-up draft
    api/opportunities     CRUD + /quote (quoting agent) + /compare
    api/carriers/[id]/quote  MOCK CARRIER PORTAL (zod-validated, appetite, deterministic rating)
    api/book, api/book/gaps, api/book/gaps/outreach
  lib/
    llm.ts                the ONLY module that calls a model (isMock, extractRiskProfile, draftText)
    mock-extract.ts       deterministic regex/keyword extractor (mock mode)
    mock-drafts.ts        templated drafts (mock mode)
    requirements.ts       missing-items engine (deterministic)
    carriers.ts           generic profile -> carrier-schema mapper + carrier zod validator
    rating.ts             premium = round(base * industryMult * sizeFactor * claimsFactor), appetite rules
    quoting.ts            the quoting agent (map -> POST portal -> quotes with logs)
    compare.ts            deterministic diff, cheapest / broadest / recommended
    rounding.ts           account-rounding rule engine
    store.ts              JSON file store (data/db.json, git-ignored)
    attachments.ts        PDF/text attachment -> text (unpdf)
  data/                   carriers.json, industries.json, book.json, sample-emails/*.txt
scripts/smoke.mjs         end-to-end smoke test (Node fetch)
```

Mock vs live: `isMock()` is true when `LLM_MOCK=1` or `ANTHROPIC_API_KEY` is unset. Live mode calls `generateObject`
(structured extraction with the `RiskProfile` zod schema) and `generateText` (drafts) via `@ai-sdk/anthropic`, model from
`ANTHROPIC_MODEL` (default `claude-opus-5-5`, no `temperature` sent). The carrier portals and rating are deterministic
code in both modes — they are never LLM calls.

## Open-source tools used

- [Next.js](https://github.com/vercel/next.js) 16 (App Router) + React 19, TypeScript
- [Vercel AI SDK](https://github.com/vercel/ai): `ai`, `@ai-sdk/anthropic`, `@ai-sdk/react` (installed per spec; no chat UI is built so `useChat` is unused)
- [zod](https://github.com/colinhacks/zod) 4 — all schemas (risk profile, carrier field schemas, request bodies)
- [unpdf](https://github.com/unjs/unpdf) — PDF text extraction
- [vitest](https://github.com/vitest-dev/vitest) — unit tests; ESLint + `eslint-config-next`

## Setup and run

Requires Node 22 and npm.

```bash
cd 2026-11-19-covera
npm install
cp .env.example .env.local     # optional; the app works with no key
npm run dev                    # http://localhost:3000
```

Production build and checks:

```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run start                  # or: npx next start -p 3100
BASE_URL=http://localhost:3000 npm run smoke   # prints SMOKE PASSED
```

## Environment variables

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Optional. When unset the app runs in deterministic mock mode. |
| `ANTHROPIC_MODEL` | Model id, default `claude-opus-5-5`. |
| `LLM_MOCK` | Set `1` to force mock mode even with a key. |
| `PORT` | Default 3000; the smoke script reads it (or `BASE_URL`). |
| `BROKERDESK_DB` | Optional path override for the JSON store (default `data/db.json`). |

## Mock mode

With no API key (or `LLM_MOCK=1`), extraction uses a regex/keyword extractor (business name from "we are" / signature
lines, `City, ST ZIP` addresses, `$1.2M revenue` / `payroll $800k` / `12 employees` forms, line keywords, industry keyword
table, sq ft / year built / sprinklered, prior claims) and drafts are templates filled from structured data. Output is
deterministic: the same input always yields the same output. The UI shows a "Mock mode — set ANTHROPIC_API_KEY for live AI" badge.

## Known limitations

- The live Anthropic path (`generateObject` / `generateText`) is implemented but was not exercised (no key available when built).
- The mock extractor is regex based and tuned to the 4 sample emails; real-world emails need the live model.
- Quote step logs appear once the quoting run finishes (no streaming/polling UI); portals are called sequentially.
- JSON file store: single process, no locking beyond atomic rename; not for production.
- Rating is a toy formula, not actuarial; carriers and appetite rules are fictional.
- No PATCH UI for editing a saved opportunity's profile (the API supports it; edit on `/intake` before saving).
- The recommended quote is one overall pick (first requested line); per-line recommendations are in the comparison diff.
- Pages were checked via HTTP status only; no browser console check was possible in the build environment.

## Next 3 things to build

1. Stream per-carrier step logs to the UI (SSE / `streamText`-style progress) and run carriers in parallel.
2. Document intake: ACORD-form / loss-run PDF parsing into the profile with per-field source citations and confidence.
3. Renewals + AMS sync: a renewal scheduler that re-quotes expiring policies and a mock AMS writer for the selected quote.
