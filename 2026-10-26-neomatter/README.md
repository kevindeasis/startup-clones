# Front Door — a Neomatter clone (AI intake & triage for in-house legal)

> **Independent educational clone. Not affiliated with, endorsed by, or derived from the code of Neomatter (formerly Lightfield) or Y Combinator.** Built from public descriptions of the product only.

## The original company

[Neomatter](https://neomatter.com) (formerly Lightfield, YC F26 — [YC profile](https://www.ycombinator.com/companies/neomatter), [launch post](https://www.ycombinator.com/launches/Vnk-neomatter-the-operating-system-for-in-house-legal-teams)) is "the operating system for in-house legal teams". It watches the channels where legal requests already arrive (email, Slack, Teams, Salesforce), routes each request to the right lawyer, reads attached documents, checks them against the team's playbook and precedents, and prepares a brief, a redline and a draft reply with a citation on every point. A lawyer approves before anything is sent. Tagline: "Every request shows up with the work already done."

## What this clone does

- **Intake**: a simulated inbox form (`/intake`, channel email/slack/teams, text attachment paste or `.txt/.md` upload) and a webhook `POST /api/intake`.
- **Triage**: retrieval over playbook clauses + past precedents (MiniSearch), then one structured LLM call (`generateObject` + zod) producing title, summary, area, urgency, ask, missing info, key terms/dates, decision card with options, redline table, draft reply, and citations.
- **Routing**: deterministic code assigns the owner by practice area.
- **Review**: matter page with original thread, brief, decision card, redline, editable draft reply, citations (inline clause text), activity timeline. Actions: approve and mark sent (nothing is sent), request more info (LLM-drafted clarifying message), reassign, close. Approved matters become precedents that future triage retrieves.
- **Dashboard** (`/`) with status counts and status/owner filters; **Playbook** (`/playbook`) with add/edit/delete and `#clause-<id>` anchors used by citations.
- **Mock LLM mode** so everything runs offline without an API key.

**Skipped** (out of scope): auth/SSO, multi-tenant, billing, real Gmail/Outlook/Slack/Teams/Salesforce connectors, PDF/DOCX parsing, real email sending, playbook change approvals, Word redline export, vector embeddings.

## Architecture

```
 /intake form ──┐                                   ┌─ retrieve (MiniSearch: top 6 clauses + 3 precedents)
                ├─> requests table ─> triageRequest ┼─ triage  (generateObject, TriageOutput zod schema; mock if no key)
 POST /api/intake┘                                   ├─ route   (deterministic: first lawyer covering the area, else default)
                                                     └─ persist (matters + events) ─> /matters/[id]
 /matters/[id] review ──> approve | request_info | reassign | close | save_reply
        approve ──> precedents row ──> retrieved by the next triage
```

Layout: `src/db` (Drizzle schema, migration, seed), `src/lib` (schemas, triage, retrieval, matter actions), `src/lib/llm` (`index.ts` provider switch `getModel()` / `runStructured()`, `mock.ts`), `src/app` (pages, server actions, API routes).

## GitHub tools used

- [vercel/next.js](https://github.com/vercel/next.js) — Next.js 16 App Router
- [vercel/ai](https://github.com/vercel/ai) — Vercel AI SDK (`ai` v7, `@ai-sdk/anthropic` v4), `generateObject`
- [colinhacks/zod](https://github.com/colinhacks/zod) — zod 4 schemas
- [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) — Drizzle ORM
- [WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite driver
- [lucaong/minisearch](https://github.com/lucaong/minisearch) — in-memory full-text retrieval
- [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) — Tailwind CSS 4

## Setup and run

Requires Node 22+.

```bash
npm install
cp .env.example .env.local     # optional; leave ANTHROPIC_API_KEY empty for mock mode
npm run seed                   # creates data/frontdoor.db: 3 lawyers, 12 clauses, 5 triaged matters
npm run dev                    # or: npm run build && npm start
# open http://localhost:3000
```

Try the webhook:

```bash
curl -X POST localhost:3000/api/intake -H 'content-type: application/json' -d '{"channel":"slack","requester_name":"Sam from Sales","subject":"Need NDA signed today","body":"Customer NDA has unlimited liability and auto-renews. Urgent, EOD.","attachments":[{"name":"nda.txt","text":"Term: perpetual. unlimited liability ... auto-renew ..."}]}'
# add ?dry_run=1 to get the triage output and retrieved_ids without saving
```

Other endpoints: `GET /api/matters`, `GET /api/matters/[id]`, `POST /api/matters/[id]/actions` (`approve|request_info|reassign|close|save_reply|choose_option`), `GET /api/health`.

## Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic key. Empty means mock mode. |
| `ANTHROPIC_MODEL` | Model id, default `claude-sonnet-5-5`. |
| `LLM_PROVIDER` | `anthropic` or `mock`; auto-mock when no key. |
| `DATABASE_PATH` | SQLite file, default `./data/frontdoor.db`. |
| `INTAKE_WEBHOOK_SECRET` | If set, `POST /api/intake` requires header `x-intake-secret`. |

## Mock mode

When `LLM_PROVIDER=mock` or no `ANTHROPIC_API_KEY` is set, `runStructured` calls `src/lib/llm/mock.ts` instead of Anthropic. It is deterministic and keyword-based: NDA/agreement/MSA/contract gives `commercial`, employee/offer letter/termination `employment`, board/resolution/stock `corporate`, GDPR/personal data/DPA `privacy`, else `general`; "urgent/today/ASAP/EOD" gives P1 else P2; one redline row per risky phrase (unlimited liability, auto-renew, perpetual, exclusive, non-compete, indemnif) citing the retrieved clause IDs. Output still goes through the zod schema. A banner is shown in the UI. `/api/health` reports `llm`.

On schema-validation failure the call retries once, then intake falls back to a minimal brief with `missing_info: ["Triage failed: ..."]`. Citations not present in the retrieved context are stripped.

## Known limitations

- Only the mock path was exercised in this build; the real Anthropic path (`generateObject`) compiles and type-checks but was not run against the live API (no key available).
- Triage runs synchronously inside the request; long LLM calls block the form submit.
- Text attachments only; no PDF/DOCX. No auth; single tenant. Nothing is really sent.
- Mock heuristics are crude (for example, redline quotes are the sentence around the keyword).
- Retrieval is lexical (BM25), so synonyms are missed; the index is rebuilt on every triage.
- No automated test suite; verification was done with curl against a production build.

## Next 3 things to build

1. Real connectors: Slack/Teams bots and Gmail ingestion feeding the webhook, with reply-in-thread on approve.
2. PDF/DOCX parsing and Word redline export (tracked changes).
3. Streaming triage with a background job queue, plus evals (a golden set of requests scoring routing, redline recall and citation accuracy).
