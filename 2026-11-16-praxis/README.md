# Docketeer: a Praxis clone (AI agents that run a small law firm's admin, lawyer approves every step)

> **Independent learning clone, not affiliated with Praxis.** All firm ("Harbor & Vale LLP"), client, matter and legal content in this repository is fictional, and nothing here is legal advice. The engagement letter is a plainly labelled fictional sample.

## What the original does

[Praxis](https://runpraxis.ai) ([YC page](https://www.ycombinator.com/companies/praxis), YC F26) sells "AI agents that run law firm operations, from first inquiry to paid invoice. Agents do the work, lawyers approve." It targets small and mid-sized US law firms and covers four pillars: **Win** (answer inquiries, screen against the firm's rules, run conflict checks, draft engagement letters), **Onboard** (collect and verify client data and documents, chase missing items), **Run** (track tasks, follow up with clients and counterparties, live client portal) and **Get paid** (send, track and chase invoices). It integrates with calendar, email, e-signature, billing and practice-management systems.

## What this clone does

A single-firm, self-hosted app where every agent-drafted outbound item is a `pending` row in an approval queue, and **nothing is written to the outbox without a lawyer's approval**.

- **Win** - `/inbox` has 8 seeded fictional leads. "Run intake" runs: LLM extract (structured output) -> deterministic screen against `firm_rules` -> deterministic conflict check (rapidfuzz `token_set_ratio`, >=85 hit, 70-84 possible) -> LLM reply draft -> LLM-filled Jinja2 engagement letter. Results are shown inline and stored on the inquiry.
- **Approval queue** - `/` lists pending drafts with editable text, rationale, Approve / Save edits & approve / Reject (reason required; reasons are fed into the agent's next prompt for that matter or inquiry). Approving sends (writes to `outbox`) and executes side effects (letter .docx/.md, client + matter creation, stage changes, invoice sent).
- **Onboard** - the client signs by typing their name in the portal; the agent builds a checklist (template items + up to 2 LLM extras) and drafts a document request. Uploads (pdf/txt/md/png/jpg, 10 MB) are verified by the LLM plus deterministic post-checks (expiry, ID name fuzzy match). When all required documents are verified the agent proposes a status update and the matter becomes `active` on approval.
- **Run** - `/matters`, `/matters/{id}` (timeline, tasks, notes, documents, time, invoices) and the tokenised client portal `/portal/{token}`. "Run daily agents" drafts escalating chasers for documents, overdue client tasks and counterparty tasks. Header buttons "Advance +1 / +7" move the simulated `settings.today`.
- **Get paid** - time entries -> "Generate invoice" (LLM rewrites narratives, totals computed in code) -> approval -> portal "Pay now"; daily agents draft payment reminders at +7 / +14 / +30 days overdue.
- `/activity` shows every LLM call (mode, model, tokens, duration, expandable prompt and response); `/outbox` shows everything "sent"; `/billing` shows AR.

### What it skips
Staff auth/roles, SaaS billing, real email / calendar / e-signature / payment / practice-management integrations (all simulated in SQLite), OCR (images are not read), multi-firm tenancy, PDF invoices (HTML view only), trust accounting, real legal templates.

## Architecture

```
app/main.py      FastAPI app, pages (Jinja2) and JSON/form API
app/db.py        sqlite3 helpers (no ORM), simulated "today", schema init
app/schema.sql   all tables      app/seed.py   fictional firm, rules, clients, matters, 8 inquiries
app/llm.py       one function per agent step -> pydantic model; live Anthropic client + MockLLM
app/prompts.py   shared system preamble + lawyer rejection feedback
app/pipeline.py  intake: extract -> screen -> conflicts -> reply -> engagement letter
app/conflicts.py normalisation + rapidfuzz matching
app/agents.py    approve/reject (the only code that writes outbox), onboarding, verification, daily agents, billing
app/letters.py   Jinja2 Markdown letter -> .md and .docx (python-docx)
app/templates/   pages + letter.md.j2        app/static/  app.css, app.js (vanilla)
tests/           pytest suite (mock mode)
```

LLM layer: `anthropic.Anthropic().messages.parse(model=..., max_tokens=4096, system=..., messages=[...], output_format=<pydantic model>, output_config={"effort": "low"|"medium"})` and `response.parsed_output`. No forced `tool_choice`, no prefill, no `temperature`, no `thinking`. Model comes from `ANTHROPIC_MODEL` (default `claude-opus-5-5`). With `MOCK_LLM=1` or no `ANTHROPIC_API_KEY`, the same public functions are served by `MockLLM`, a deterministic keyword-rule implementation, so the whole app and test suite run offline. Rules (screening, conflicts, totals, expiry and name post-checks) are code, never LLM.

## GitHub tools used
- [fastapi/fastapi](https://github.com/fastapi/fastapi) - web framework
- [Kludex/uvicorn](https://github.com/Kludex/uvicorn) - ASGI server
- [pallets/jinja](https://github.com/pallets/jinja) - page and engagement-letter templates
- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) - Claude structured outputs
- [pydantic/pydantic](https://github.com/pydantic/pydantic) - output schemas
- [rapidfuzz/RapidFuzz](https://github.com/rapidfuzz/RapidFuzz) - conflict check and name matching
- [py-pdf/pypdf](https://github.com/py-pdf/pypdf) - PDF text extraction
- [python-openxml/python-docx](https://github.com/python-openxml/python-docx) - engagement letter .docx
- [Python-Markdown/markdown](https://github.com/Python-Markdown/markdown) - letter/email previews
- [pytest-dev/pytest](https://github.com/pytest-dev/pytest) and [encode/httpx](https://github.com/encode/httpx) - tests via FastAPI `TestClient`
- Also: python-multipart (uploads/forms), python-dotenv (`.env`)

## Setup and run

```bash
cd 2026-11-16-praxis
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # leave ANTHROPIC_API_KEY blank for mock mode
pytest -q                     # 17 tests, mock mode
uvicorn app.main:app --port 8000
# open http://localhost:8000
```
The SQLite database is created and seeded on first start in `data/` (git-ignored). Delete `data/` to reset.

### Environment variables (`.env.example`)
| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | blank | blank -> mock mode |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | cheaper: `claude-sonnet-5-5`; never add a date suffix |
| `MOCK_LLM` | blank | `1` forces mock even with a key |
| `DATABASE_PATH` | `data/docketeer.db` | SQLite file |
| `UPLOAD_DIR` | `data/uploads` | client uploads |
| `CHASE_AFTER_DAYS` | `3` | days before a chaser |
| `INVOICE_NET_DAYS` | `30` | invoice terms |
| `PORT` | `8000` | used to build portal links (`PUBLIC_BASE_URL` overrides) |

Optional extras: `LETTERS_DIR` (default `data/letters`), `PUBLIC_BASE_URL`, `DOCKETEER_TODAY` (seed date, for tests).

## Demo walkthrough (works in mock mode)
1. **Intake**: open `/inbox`, click "Run intake" on *Fired after reporting unpaid overtime* (id 1). See extract, screen = accept, conflict check clear, reply + engagement letter drafted.
2. **Approve the letter** on `/` (optionally edit text). This creates the client and matter (`engagement_sent`), writes `data/letters/<id>.docx` + `.md`, and an outbox row. Approve the reply too.
3. **Sign in the portal**: open the matter's portal link from `/matters`, type "Maria Santos", tick the box, Sign. The matter goes to `onboarding`, the checklist appears and a `document_request` approval is queued.
4. **Upload a txt document**: for "Government-issued photo ID" upload a file with `DRIVER LICENSE`, `Name: Maria Santos`, `EXPIRES: 2031-01-01` -> verified. Try a different name (mismatch) or `EXPIRES: 2020-01-01` (expired).
5. **Run daily agents** (header button), after "Advance +1/+7": chasers for outstanding documents appear, plus a stage-2 payment reminder for the seeded overdue Northwind invoice.
6. **Generate invoice** on `/matters/1` (Dana Whitfield has unbilled time).
7. **Approve** the `invoice_email` in the queue: the invoice becomes `sent` and shows in her portal.
8. **Pay**: click "Pay now" in the portal; `/billing` shows it paid.

Curl equivalent: `POST /api/inquiries/1/run`, `POST /api/approvals/{id}/approve`, `POST /api/portal/{token}/sign` (`name`, `agree=on`), `POST /api/portal/{token}/upload` (multipart `document_id`, `file`), `POST /agents/run-daily`, `POST /api/matters/1/invoice`, `POST /api/portal/{token}/pay/{invoice_id}`.

## Known limitations
- Mock mode is keyword rules: good enough for the seeded leads and tests, not general-purpose. The live path (`messages.parse`) is implemented per the spec but was **not exercised** here (no API key in the build sandbox).
- No auth: anyone with the URL is staff; portal tokens are the only client protection.
- Images are not OCR'd (they go to `needs_lawyer`; a lawyer can "Mark verified").
- Chasers are drafted regardless of whether the first document request was approved yet (spec-literal).
- Invoice total is the exact sum of minutes x rate rounded once; individual line amounts are rounded separately and can differ by a cent.
- No email threading, calendar booking or real e-signature; sqlite connections are opened per call (fine for a demo, not for load).
- Date handling is a simulated calendar (`settings.today`), not wall-clock.

## Next 3 things to build
1. Real integrations behind the same approval gate: Gmail/Outlook inbound sync, calendar booking for the proposed consult times, and a real e-signature provider.
2. Staff auth with roles (partner vs paralegal approval rights) and an audit trail of who approved what.
3. Trust/IOLTA-aware billing with Stripe payment links, PDF invoices and a practice-management export (Clio-style).
