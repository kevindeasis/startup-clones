# Prompt sent to the Sonnet subagent (verbatim)

You are building a working end-to-end clone inside /home/user/startup-clones/2026-11-10-collar-ai/ exactly per the spec below (SPEC.md already exists there; do not overwrite it). Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets.
- Add a `.gitignore` appropriate for the stack (venv, .env, __pycache__, local databases, .pytest_cache).
- Verify it: create a venv OUTSIDE the repo folder or ignored (e.g. /tmp/irdesk-venv), install dependencies, run tests, start the app locally and confirm it boots and every main flow works via curl in mock mode (no API key available). Fix errors before finishing. Do not claim it works unless you actually ran it. Stop any background server when done.
- Write a thorough README.md in the folder: what the original company does (link https://usecollarai.com), what this clone does and skips, architecture summary, the GitHub tools used, exact setup/run steps, env vars, known limitations, next 3 things to build. State that it is an independent learning clone not affiliated with the company.
- Do not modify anything outside that folder. Do not commit or push.
- Report back: what was built, exactly which verification commands were run and their results, anything that does not work, and your total input/output token usage.

===== SPEC.md =====
# Build spec — Collar AI clone ("IR Desk": AI for public-company investor relations)

**Original:** Collar AI (YC F26) — https://usecollarai.com · YC batch list: https://www.roundfunded.com/en/yc-startups/fall-2026
**Product (from the public site):** AI for public-company IR teams: investor targeting (rank investors by fit), live earnings-call Q&A support (suggested answers to analyst questions with citations to filings and Q&A prep), IR CRM that updates itself from call notes, an "IR front desk" that answers investor questions using only disclosed IR documents, and announcement modeling.
**Clone name:** `irdesk`. Single-tenant, self-hosted, no auth, no real integrations (FactSet/Bloomberg/Q4 skipped).

## Flows (all required)
1. **Document library + ingest.** Upload PDF/DOCX/XLSX/TXT/MD IR documents (earnings script, press release, 10-K excerpt, Q&A prep, guidance). Each is parsed, chunked (~800 chars, overlap 100, keep doc id + page/section label), stored in SQLite. A "Load demo company" button seeds a fictional company ("Northwind Robotics, NWR") with ~5 demo docs and ~8 demo investors so the app is usable without uploads. Demo content lives in `app/demo_data/`.
2. **Live Q&A assist.** User pastes an analyst question (and optional "mode": earnings-call / front-desk). Retrieve top-k chunks (BM25), LLM returns JSON: `answer` (short, speakable, 2-4 sentences), `confidence` (high/medium/low), `citations` [{chunk_id, doc, quote}], `disclosure_risk` (flags e.g. forward-looking statement not in disclosed materials, Reg FD concern) and `follow_ups`. If nothing relevant is retrieved, answer must be "Not covered by disclosed materials — defer" with confidence low. Never invent figures: every number in the answer must appear in a cited chunk (server validates: numbers in answer not found in cited chunk text → add warning).
3. **IR front desk.** Public-style chat page `/desk` answering investor questions ONLY from documents flagged `public=true`; others are excluded from retrieval. Refuses (polite deferral) when unsupported. Conversation history kept in the session in memory.
4. **IR CRM from call notes.** Paste raw meeting/call notes → LLM extracts structured JSON: investor/fund, attendees, topics, sentiment (positive/neutral/negative), concerns, asks/next steps with owner and due date, then upserts the investor record and appends an interaction. Investors list page with last contact, next step, sentiment trend.
5. **Investor targeting.** For a given investor fund profile table (name, AUM, style: growth/value/GARP/quant, mandate, sector focus, holds_us bool, meeting count) compute a deterministic fit score (weights by style vs company profile, sector overlap, AUM band, recency) AND ask the LLM for a 2-sentence rationale per top-N. Ranked table with score breakdown.
(Skip announcement modeling except a stub endpoint that returns 501 with explanation.)

## Stack
Python 3.11+, FastAPI + Uvicorn, SQLite via stdlib `sqlite3`, Jinja2 templates + a little vanilla JS/CSS (no build step), pydantic v2.
Libraries (all verified on PyPI): `anthropic` (LLM; default model `claude-sonnet-5-5`, override via `ANTHROPIC_MODEL`), `fastapi`, `uvicorn`, `pydantic`, `rank-bm25` (retrieval), `pypdf` (PDF), `python-docx` (DOCX), `openpyxl` (XLSX), `jinja2`, `python-multipart`, `pytest` + `httpx` for tests.

## Data model (SQLite)
documents(id, title, kind, public, created_at); chunks(id, document_id, ordinal, label, text); investors(id, name, style, aum_musd, mandate, sectors, holds_us, created_at); interactions(id, investor_id, date, summary, topics_json, sentiment, concerns_json, next_steps_json, raw_notes); qa_log(id, mode, question, response_json, created_at).

## Endpoints / screens
`GET /` dashboard; `/docs-library` (upload, toggle public, delete); `/qa` (analyst Q&A assist); `/desk` (front desk chat); `/investors` + `/investors/{id}`; `/targeting`; `/notes`. JSON API under `/api/*`: `POST /api/documents`, `POST /api/demo/load`, `POST /api/qa`, `POST /api/desk`, `POST /api/notes`, `GET /api/investors`, `GET /api/targeting`, `GET /health`.

## LLM design
`app/llm.py`: one function `complete_json(system, user, schema_hint)` using the Anthropic SDK with prompts that demand JSON-only output; robust JSON extraction + one retry. If `ANTHROPIC_API_KEY` is unset or `MOCK_LLM=1`, use a deterministic **mock mode**: Q&A returns the top chunk sentences as the answer with real citations; notes extraction uses simple regex/keyword heuristics; rationale is templated. Mock mode must make every flow work end to end and the UI must show a "mock mode" badge.
Env: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `MOCK_LLM`, `DATABASE_PATH` (default `./irdesk.db`), `PORT`.

## Skip
Auth, billing, multi-tenant, real market-data/CRM integrations, audio/live transcription, stock-reaction modeling.

## Acceptance checks
- `pytest` passes (chunking, BM25 retrieval, number-validation, scoring determinism, API tests for each flow in mock mode).
- App boots with `uvicorn app.main:app`; `/health` 200; load demo → `/api/qa` with "What was Q3 revenue growth?" returns an answer with ≥1 citation; `/api/desk` refuses a question about a non-public doc; `/api/notes` creates an interaction and upserts investor; `/api/targeting` returns ranked list with scores.
- `.env.example`, `.gitignore` (db, venv, __pycache__, .env), README.

---
## Note on the dispatched message
The Agent call itself was a short wrapper: it pointed the Sonnet subagent at SPEC.md and at this file (instructions at top, then the spec above), restating: real runnable app, venv outside the repo (/tmp/irdesk-venv), run pytest, boot and curl every flow in mock mode, write README.md, touch nothing outside the folder, no commit/push, report results and token usage. No fix rounds were needed (0 fix prompts).
