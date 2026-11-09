# Build spec — Neomatter clone ("Front Door": AI intake & triage for in-house legal)

**Original company:** Neomatter (YC F26), formerly Lightfield — https://neomatter.com · YC profile: https://www.ycombinator.com/companies/neomatter · Launch post: https://www.ycombinator.com/launches/Vnk-neomatter-the-operating-system-for-in-house-legal-teams

**One-line:** Neomatter watches the channels where legal requests already arrive (email, Slack, Teams, Salesforce), triages each request to the right lawyer, reads the attached documents, checks them against the team's playbook and precedents, prepares a brief + redline + draft reply with a citation on every point, and waits for a lawyer to approve before anything is sent. Tagline: "Every request shows up with the work already done."

**Clone name:** `frontdoor` — a self-hosted, single-tenant version of that loop, with a simulated inbox and a webhook instead of real Gmail/Slack integrations.

---

## 1. What the clone does

A web app where:

1. Legal requests arrive either through a **simulated inbox form** (pick channel: email / slack / teams, enter requester, subject, body, paste or upload a text attachment) or through a **webhook** `POST /api/intake` that any real integration (Zapier, n8n, Slack bot) could call later.
2. Each request is **triaged by an LLM pipeline** into a *matter*: title, summary, practice area, urgency, the concrete ask, missing information, routed owner (from team rules), key terms/dates extracted, whether a **decision is required**, the decision options with a recommended one, a **redline table** (when a contract text is attached), and a **draft reply** to the requester. Every recommendation and redline carries **citations** to playbook clause IDs and/or precedent matter IDs that were retrieved for the request.
3. A **matter dashboard** lists open matters (owner, status, urgency, "waiting on"), and a **matter detail page** shows the original thread, the brief, the redline, the decision card, and the editable draft reply. The lawyer can **approve & mark sent** (nothing is actually sent — this mirrors Neomatter's "a lawyer presses Send"), **request more info** (LLM drafts a clarifying message), **reassign**, or **close**. Approved matters become **precedents** that future triage retrieves.
4. A **playbook page** lists the team's standard positions (clauses with standard position, fallback, walk-away point, approver) and lets the lawyer add/edit/delete clauses. Citations on matters deep-link to the clause.

## 2. Core user flows to implement (all five are required)

| # | Flow | Entry | Result |
|---|------|-------|--------|
| F1 | Intake | `/intake` form or `POST /api/intake` | Request row stored; triage pipeline runs synchronously; redirect to `/matters/[id]` |
| F2 | Triage & brief | automatic after F1 | Matter row with structured brief JSON + citations; status `in_review` |
| F3 | Review & decide | `/matters/[id]` | Edit draft reply, pick a decision option, click **Approve & mark sent** → status `approved`, precedent created; **Request more info** → generates clarifying message, status `waiting_on_requester`; **Reassign** owner; **Close** |
| F4 | Team view | `/` (dashboard) | Table of matters with filters by status and owner; counts by status at top |
| F5 | Playbook | `/playbook` | CRUD for clauses; clause detail anchor `#clause-<id>` used by citations |

## 3. Stack (fixed — do not substitute)

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS** — scaffold with `npx create-next-app@latest frontdoor --ts --tailwind --eslint --app --src-dir --no-import-alias --use-npm` inside the project folder (or hand-roll an equivalent minimal setup if the scaffolder prompts/fails; keep Tailwind). The app lives directly in the project folder root (not nested), i.e. `package.json` sits in `/home/claude/startup-clone/2026-10-26-neomatter/`. If the scaffolder insists on a subdirectory, scaffold then move the files up.
- **Vercel AI SDK** — `ai` (currently v7.x) + `@ai-sdk/anthropic` (v4.x). Use `generateObject` with `zod` schemas for every structured step. **Verify the exact API against the installed package's type definitions** (`node_modules/ai/dist/index.d.ts`) rather than memory; v7 exports `generateObject`, `generateText`, `streamText`, `Output`.
- **zod** v4 — schemas for the brief, redline, decision, reply, and the intake webhook body.
- **Drizzle ORM + better-sqlite3** — SQLite file at `./data/frontdoor.db` (gitignored). better-sqlite3 v13 installs cleanly on Node 22 here (verified). Use `drizzle-orm/better-sqlite3`; create tables with a simple `CREATE TABLE IF NOT EXISTS` migration script run on startup (`src/db/migrate.ts`) — no drizzle-kit required (fine to include if it works without prompting).
- **MiniSearch** (`minisearch`) — in-memory BM25-style retrieval over playbook clauses + precedent matters for the RAG step (no embeddings, no vector DB, works offline).
- **No auth, no billing, no real email/Slack sending.**

GitHub repos these map to (for the README): vercel/next.js, vercel/ai, colinhacks/zod, drizzle-team/drizzle-orm, WiseLibs/better-sqlite3, lucaong/minisearch, tailwindlabs/tailwindcss.

## 4. LLM provider & mock mode (mandatory)

- Provider: Anthropic via `@ai-sdk/anthropic`, model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Key from `ANTHROPIC_API_KEY`.
- **Mock mode:** if `LLM_PROVIDER=mock` **or** `ANTHROPIC_API_KEY` is unset, use a deterministic in-process mock (`src/lib/llm/mock.ts`) that returns schema-valid objects derived from simple keyword heuristics over the request text (e.g. text containing "NDA"/"agreement"/"MSA"/"contract" → practice area `commercial`; "employee"/"offer letter"/"termination" → `employment`; "board"/"resolution"/"stock" → `corporate`; "GDPR"/"personal data"/"DPA" → `privacy`; otherwise `general`; urgency P1 if text contains "urgent"/"today"/"ASAP"/"EOD", else P2). The mock must also fabricate a plausible redline (one row per detected risky phrase: "unlimited liability", "auto-renew", "perpetual", "exclusive", "non-compete", "indemnif") and cite the retrieved clause IDs it was given. The mock is what the verification in this session will use because **no API key is available in the build environment**. The UI must show a small banner "Mock LLM mode — set ANTHROPIC_API_KEY for real triage" when mock is active.
- Put the provider switch behind one function: `getModel()` / `runStructured(schema, system, prompt)` in `src/lib/llm/index.ts` so the rest of the app never imports the provider directly.

## 5. Data model (SQLite via Drizzle)

```
lawyers        id (text pk), name, email, practice_areas (json string[]), is_default (int)
requests       id (text pk, nanoid-ish), channel ('email'|'slack'|'teams'|'webhook'), requester_name, requester_email,
               subject, body, attachments (json [{name, text}]), received_at (int epoch ms)
matters        id (text pk), request_id (fk), title, summary, practice_area, urgency ('P0'|'P1'|'P2'|'P3'),
               status ('new'|'in_review'|'waiting_on_requester'|'approved'|'closed'),
               owner_id (fk lawyers, nullable), waiting_on (text, nullable),
               brief (json — full TriageOutput, see §7), draft_reply (text, editable copy),
               chosen_option (text nullable), clarifying_message (text nullable),
               created_at, updated_at (int epoch ms)
playbook_clauses id (text pk, e.g. 'PB-LIAB-01'), practice_area, title, standard_position, fallback_position,
               walk_away, approver (text), created_at, updated_at
precedents     id (text pk), matter_id (fk), practice_area, summary, outcome (text), created_at
events         id (int pk autoinc), matter_id, type ('created'|'triaged'|'reassigned'|'info_requested'|'approved'|'closed'|'reply_edited'), payload (json), created_at
```

Seed (`npm run seed`, idempotent): 3 lawyers (e.g. Priya Shah — commercial/privacy, default; Marcus Lee — employment/general; Dana Ortiz — corporate), ~12 playbook clauses across commercial (liability cap, indemnity, governing law, payment terms, auto-renewal, termination for convenience, confidentiality term), privacy (DPA required, sub-processor notice), employment (non-compete, offer letter approvals), corporate (board approval threshold), and 5 sample requests already triaged (run them through the pipeline in the seed so the dashboard is non-empty on first boot). One sample must include a short fake MSA text as an attachment containing "unlimited liability", "auto-renew", and "perpetual" so the redline has rows.

## 6. Screens & endpoints

Pages (App Router, server components + small client components):
- `/` dashboard: status counts; table (title, requester, channel, area, urgency, owner, status, waiting on, updated); filters via search params `?status=&owner=`.
- `/intake`: form (channel select, requester name/email, subject, body textarea, attachment: textarea "paste document text" + `.txt/.md` file input read client-side into text). Submit → server action or `POST /api/intake` → redirect to the new matter.
- `/matters/[id]`: left column = original request (channel badge, requester, subject, body, attachments collapsible); right column = Brief card (summary, ask, area, urgency, owner, missing info, key terms/dates), Decision card (if `decision_required`: options with pros/cons, recommended highlighted, radio to choose, each option lists citations), Redline table (clause quote / issue / proposed language / citation), Draft reply (textarea, "Save edit"), Citations list (click → shows cited clause text inline or scrolls to the request passage), Actions (Approve & mark sent, Request more info, Reassign select, Close), Activity timeline from `events`.
- `/playbook`: list grouped by practice area; add/edit/delete via forms (server actions); anchors `#clause-<id>`.

API routes:
- `POST /api/intake` — body validated with zod: `{channel, requester_name, requester_email?, subject, body, attachments?: [{name, text}]}` → creates request, runs triage, returns `{matter_id, url}` (201). Also accept `?dry_run=1` returning the triage output without saving (handy for testing).
- `GET /api/matters` — list JSON; `GET /api/matters/[id]` — detail JSON.
- `POST /api/matters/[id]/actions` — `{action: 'approve'|'request_info'|'reassign'|'close'|'save_reply'|'choose_option', ...}`.
- `GET /api/health` — `{ok:true, llm:'mock'|'anthropic'}`.

## 7. LLM pipeline design

Single orchestrator `triageRequest(requestId)` in `src/lib/triage.ts`:

1. **Retrieve** — build a MiniSearch index over `playbook_clauses` (fields: title, standard_position, fallback_position, walk_away, practice_area) and `precedents` (summary, outcome). Query with subject + body + first 2k chars of attachments; take top 6 clauses + top 3 precedents. Pass them to the LLM as a numbered context block with their IDs.
2. **Triage call** (`generateObject`, schema `TriageOutput`):
   ```
   title, summary (2–3 sentences), practice_area (enum), urgency (enum P0–P3 with one-line reason),
   ask (what the requester concretely wants), missing_info (string[]), key_terms ([{label, value}]), dates ([{label, date}]),
   decision_required (bool), decision: {question, options: [{label, rationale, risk, citations: string[]}], recommended_label},
   redline: [{clause_quote, issue, proposed_language, citations: string[]}],
   draft_reply (plain text, addressed to requester, ≤180 words, never promises to sign or send),
   citations_used: string[]   // union of clause/precedent IDs referenced
   ```
   System prompt rules: act as a senior in-house legal operations assistant; only cite IDs that appear in the provided context; if nothing relevant is retrieved say so in `missing_info`; never claim to have sent anything; redline only against attached text (empty array if no attachment); be concise.
3. **Route** — deterministic code, not LLM: owner = first lawyer whose `practice_areas` contains the area, else the default lawyer. Status → `in_review`. `waiting_on` = "Legal review".
4. **Persist** matter + `events` rows (`created`, `triaged`).
5. **Request more info** action: second `generateObject` call with schema `{message}` given the brief's `missing_info` → stored in `clarifying_message`, status `waiting_on_requester`, `waiting_on` = requester name.
6. **Approve**: status `approved`, insert `precedents` row (summary + chosen option/outcome), event `approved`. MiniSearch index is rebuilt on each triage from DB (cheap at this scale).

Validate every LLM output with the zod schema; on validation failure retry once, then fall back to a minimal brief with `missing_info: ["Triage failed: <error>"]` so intake never hard-fails.

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # leave empty to run in mock mode
ANTHROPIC_MODEL=claude-sonnet-5-5
LLM_PROVIDER=                 # 'anthropic' | 'mock' (auto: mock when key missing)
DATABASE_PATH=./data/frontdoor.db
INTAKE_WEBHOOK_SECRET=        # optional; if set, POST /api/intake must send header x-intake-secret
```

## 9. Skip (explicitly out of scope)

Auth/SSO, multi-tenant, billing, real Gmail/Outlook/Slack/Teams/Salesforce connectors (webhook stands in), PDF/DOCX parsing (text only; note as next step), actual email sending, playbook change approvals, redline export to Word, vector embeddings.

## 10. Acceptance checks (the build must pass all of these; report the command + output for each)

1. `npm install` and `npm run build` exit 0 with no TypeScript errors.
2. `npm run seed` creates `data/frontdoor.db` with 3 lawyers, ≥12 clauses, 5 triaged matters (print counts).
3. `npm run dev` (or `npm start` after build) boots; `curl -s localhost:3000/api/health` returns `{"ok":true,"llm":"mock"}` when no key is set.
4. `curl -s -X POST localhost:3000/api/intake -H 'content-type: application/json' -d '{"channel":"slack","requester_name":"Sam from Sales","subject":"Need NDA signed today","body":"Customer sent their NDA, it has unlimited liability and auto-renews. Urgent, closing EOD.","attachments":[{"name":"nda.txt","text":"... Term: perpetual. The Receiving Party shall have unlimited liability ... This Agreement shall auto-renew ..."}]}'` returns 201 with a `matter_id`; the matter has `practice_area: commercial`, urgency P0 or P1, owner Priya Shah, `redline.length >= 2`, `citations_used.length >= 1`, and a non-empty `draft_reply`.
5. `GET /` renders the dashboard with the seeded matters (curl the HTML and grep for a seeded title). `GET /matters/<id>` renders the brief, redline table, and draft reply. `GET /playbook` lists the clauses.
6. `POST /api/matters/<id>/actions {"action":"request_info"}` sets status `waiting_on_requester` and a non-empty `clarifying_message`; `{"action":"approve","chosen_option":"..."}` sets status `approved` and creates a `precedents` row; a subsequent intake with similar text retrieves that precedent (its ID appears in the context passed to the LLM — log it or expose in `?dry_run=1` output as `retrieved_ids`).
7. Webhook secret: with `INTAKE_WEBHOOK_SECRET=abc`, a POST without the header returns 401.
8. `.gitignore` excludes `node_modules`, `.next`, `.env`, `data/*.db`; `.env.example` present; README complete per the instructions.
