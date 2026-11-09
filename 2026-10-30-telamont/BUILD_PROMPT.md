# BUILD_PROMPT.md

Exact, verbatim prompts sent to the Sonnet build subagent, in order.

## Round 0 — initial build prompt (model: sonnet, subagent_type: general-purpose)

```text
You are building a working clone of the YC F26 startup Telamont inside the folder `/home/claude/startup-clone/2026-10-30-telamont/` (it already contains SPEC.md, BUILD_PROMPT.md and BUILD_LOG.md — leave those files alone). Build the working end-to-end clone exactly per the spec below. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them.

Rules:
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is no ANTHROPIC_API_KEY in this environment, so everything must run and be verified in mock mode; the Anthropic provider must still be fully implemented and exercised by a unit test that monkeypatches the client.
- Add a `.gitignore` appropriate for the stack (.venv, venv, __pycache__, .env, data/, *.db, node_modules, .pytest_cache). Do commit `sample_docs/*.pdf` (keep them small).
- Verify it: install dependencies into `.venv`, run `python scripts/make_sample_docs.py`, run `pytest -q`, start the app with uvicorn and confirm it boots and the main flow works end to end with curl (create project -> upload the 3 sample PDFs -> detect -> list risks -> patch status -> ask -> notice). Also load the UI with Playwright (pre-installed; do NOT run `playwright install`) and save a screenshot to `docs/screenshot.png`. Fix errors before finishing. Do not claim it works unless you actually ran it.
- Write a thorough `README.md` in the folder: what the original company does (with links from the spec), what this clone does and what it skips, architecture summary, the GitHub tools used, exact setup and run steps, environment variables, known limitations, assumptions, and the next 3 things to build.
- Do not modify anything outside that folder. Do not commit or push. Do not create git branches.
- Use `python3 -m venv .venv` and the venv's pip/python for everything; pip install may need `--break-system-packages` only if you skip the venv (don't skip it).
- Keep the UI dependency-free (no CDN scripts required) so it works offline.

When finished, report back in this exact structure:
1. WHAT WAS BUILT — files created and the features implemented.
2. VERIFICATION — every verification command you ran and its actual result (pass/fail, counts, key output lines).
3. NOT WORKING / CAVEATS — anything that does not work or was simplified.
4. TOKEN USAGE — your total input and output tokens for this task, as best you can report them.

=== SPEC.md (verbatim) ===
# Build spec — Telamont clone ("Girder")

Date: 2026-10-30
Original company: Telamont (YC F26) — https://telamont.com — YC page: https://www.ycombinator.com/companies/telamont
Tagline of the original: "Sentry for errors in construction documents."

## 1. What the product does

Telamont ingests a construction project's documents (contracts, subcontracts, specifications, drawing notes, schedules, addenda), reads them *together*, and flags technical, contractual and compliance risks — especially contradictions between documents — before they turn into RFIs, change orders or disputes. Every finding cites the clause/page it came from. Teams triage risks on a board (owner, status), ask an AI agent questions about the documents (answers cite clauses), and draft formal notices / RFIs from the governing clause.

The clone, **Girder**, implements that core loop for a single project at a time, running locally, with PDF/TXT/MD uploads instead of Procore/Autodesk/SharePoint integrations.

## 2. Core user flows to implement (all five)

1. **Create a project and upload documents.** User creates a project (name), uploads one or more files (PDF, TXT, MD). Each file is extracted to text page by page, chunked, and stored. The UI shows each document with page count and extraction status.
2. **Detect risks.** User clicks "Detect risks". The pipeline (section 7) produces a list of findings, each with title, category, severity, description, recommended action, and one or more citations (document, page, verbatim quote). Contradictions carry citations from two or more documents.
3. **Triage on the risk board.** Risks are listed with filters (category, severity, status). User can open a risk to see citations, set an owner (free text), and change status: `open → in_review → resolved | dismissed`.
4. **Ask the documents.** A chat box: user asks a question; the system retrieves the most relevant chunks (BM25) and the LLM answers *only* from those chunks, returning an answer plus citations (document, page, quote). Show "No basis found in the documents" when retrieval is empty or the LLM says it cannot answer.
5. **Draft a notice.** From a risk, user clicks "Draft notice". The LLM writes a short formal notice/RFI letter to the counterparty citing the governing clause(s) from the risk's citations. User can copy it.

## 3. Stack

- **Backend:** Python 3.11+, FastAPI, Uvicorn, SQLModel (SQLite), Pydantic v2.
- **Frontend:** a single static page `app/static/index.html` with vanilla JS + CSS (no build step), served by FastAPI at `/`. Keep it clean and usable: left column = project & documents, center = risk board, right/bottom = Ask panel. No framework, no CDN dependencies required.
- **LLM:** Anthropic Python SDK (`anthropic`), model from `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`). Also a deterministic **mock provider** so the whole app runs and is testable with no API key.

## 4. Open-source libraries to use (all verified on PyPI 2026-10-30)

| Library | Repo | Used for |
|---|---|---|
| fastapi | https://github.com/fastapi/fastapi | HTTP API + serving the static UI |
| uvicorn | https://github.com/Kludex/uvicorn | ASGI server |
| sqlmodel | https://github.com/fastapi/sqlmodel | ORM + SQLite persistence |
| pypdf | https://github.com/py-pdf/pypdf | PDF text extraction (page by page) |
| rank-bm25 | https://github.com/dorianbrown/rank_bm25 | lexical retrieval for Ask (no embeddings service needed) |
| anthropic | https://github.com/anthropics/anthropic-sdk-python | LLM calls (Messages API) |
| reportlab | https://pypi.org/project/reportlab/ | generating the sample construction PDFs (dev script only) |
| python-multipart | https://github.com/Kludex/python-multipart | file uploads in FastAPI |
| pytest + httpx | — | tests via FastAPI TestClient |

Pin versions in `requirements.txt` (use the current releases; e.g. `pypdf>=6,<7`, `fastapi>=0.115`, `sqlmodel>=0.0.22`, `anthropic>=0.40`, `rank-bm25==0.2.2`, `reportlab>=4`). Do not use Docling, torch, or any embedding model — keep install < 2 minutes.

## 5. Data model (SQLModel, SQLite file `data/girder.db`)

- `Project(id, name, created_at)`
- `Document(id, project_id, filename, kind: contract|spec|drawing|schedule|other (user-picked or guessed from filename), page_count, char_count, status: uploaded|extracted|failed, created_at)`
- `Chunk(id, document_id, page, idx, text)` — chunks ~1,200–1,800 chars, split on paragraph boundaries, never across pages.
- `Risk(id, project_id, title, category: contradiction|contractual|technical|compliance, severity: high|medium|low, description, recommendation, status: open|in_review|resolved|dismissed, owner: str|None, created_at, updated_at)`
- `Citation(id, risk_id, document_id, page, quote)`
- `Question(id, project_id, question, answer, citations_json, created_at)` — history for the Ask panel.

## 6. Endpoints (all JSON under `/api`)

- `GET /api/health` → `{"ok": true, "llm_provider": "mock"|"anthropic", "model": "..."}`
- `POST /api/projects` `{name}` → project; `GET /api/projects`; `GET /api/projects/{id}` (with documents + counts)
- `POST /api/projects/{id}/documents` (multipart, one or many files, optional `kind`) → extracts + chunks synchronously; returns documents
- `GET /api/projects/{id}/documents`; `DELETE /api/documents/{doc_id}`
- `POST /api/projects/{id}/detect` → runs the pipeline, replaces previous *open* auto-generated risks for the project (keep resolved/dismissed), returns risks with citations
- `GET /api/projects/{id}/risks?category=&severity=&status=` → risks with citations
- `PATCH /api/risks/{id}` `{status?, owner?}` → risk
- `POST /api/risks/{id}/notice` → `{notice: str}`
- `POST /api/projects/{id}/ask` `{question}` → `{answer, citations: [{document_id, filename, page, quote}]}`; also persisted
- `GET /api/projects/{id}/questions` → history
- `GET /` → the UI

## 7. LLM pipeline design

Provider abstraction `app/llm.py` with `complete_json(system, user, schema_hint) -> dict` and `complete_text(system, user) -> str`. Provider selected by `LLM_PROVIDER` = `auto` (anthropic if `ANTHROPIC_API_KEY` set, else mock) | `anthropic` | `mock`. Anthropic calls use `client.messages.create`, `max_tokens` 4096, temperature 0, and must robustly parse JSON (strip code fences; on parse failure retry once asking for valid JSON only).

**Detection — two stages, so it scales beyond toy inputs:**

- **Stage 1 — Requirement extraction, per document chunk window.** Batch each document's chunks into windows of ≤ ~12k chars. For each window the LLM returns `requirements: [{topic, value, clause_ref, page, quote, kind: contractual|technical|compliance}]` where `topic` is a short normalized key (e.g. `concrete_compressive_strength`, `substantial_completion_days`, `notice_period_days`, `liquidated_damages_rate`, `retainage_percent`, `warranty_period`), `value` is the literal requirement, `quote` is a verbatim excerpt ≤ 300 chars, and also `single_doc_risks: [{title, category, severity, description, recommendation, page, quote}]` for things risky on their own (missing notice period, unlimited liability, pay-when-paid, ambiguous scope, missing code reference). Store nothing extra in the DB for this stage — hold in memory.
- **Stage 2 — Cross-document comparison, one call.** Send all requirement cards (compact JSON, with document filename + page) and ask the LLM for `risks: [{title, category: "contradiction", severity, description, recommendation, citations: [{document, page, quote}]}]` where each contradiction has ≥ 2 citations from ≥ 2 documents with conflicting `value` on the same `topic`, and to describe which document likely governs (order-of-precedence clause if one exists). If the card set exceeds ~60k chars, group cards by topic and compare in batches.
- Merge Stage-1 single-document risks and Stage-2 contradictions, dedupe by (title, first citation), map citations back to `Document` rows by filename, persist.

**Mock provider behaviour (must be deterministic and make the demo real):**
- Stage 1 mock: scan each chunk for lines matching a small keyword→topic table (e.g. `psi` → `concrete_compressive_strength`; `calendar days`/`substantial completion` → `substantial_completion_days`; `notice` + `days` → `notice_period_days`; `liquidated damages` → `liquidated_damages_rate`; `retainage` → `retainage_percent`; `warranty` → `warranty_period`) and extract the first number + unit as the value, with the sentence as quote. Flag a single-doc risk if a chunk contains `pay-when-paid`, `pay if paid`, `unlimited`, or `time is of the essence` without a notice period.
- Stage 2 mock: for each topic with ≥ 2 cards from different documents whose normalized values differ, emit a contradiction risk (severity high for strength/dates/money, medium otherwise) with both citations.
- Ask mock: return the top-3 retrieved chunks summarized as "Based on the documents: …" with citations.
- Notice mock: fill a fixed letter template with the risk title and citations.

**Ask:** build (and cache in memory per project, invalidated on upload/delete) a BM25 index over all chunk texts; retrieve top 6 chunks; prompt the LLM to answer only from the provided excerpts and return `{answer, citations:[{document, page, quote}]}`.

**Notice:** prompt with the risk + citations; return plain text in formal letter form (subject, reference to clause, statement of issue, requested action, response deadline placeholder).

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # leave empty to run in mock mode
ANTHROPIC_MODEL=claude-sonnet-5-5
LLM_PROVIDER=auto             # auto | anthropic | mock
DATABASE_URL=sqlite:///./data/girder.db
UPLOAD_DIR=./data/uploads
PORT=8000
```

Load with `python-dotenv` if present, but never require a `.env` file.

## 9. Skip

Auth, billing, multi-tenant/teams, Procore/Autodesk/SharePoint/Box/Dropbox/Teams/Slack/Outlook/iMessage integrations, voice, drawing/image understanding (PDFs are text-extracted only; scanned PDFs are reported as `failed` with a clear message), scheduled re-sync of revisions, email sending, SOC2 anything.

## 10. Repo layout

```
2026-10-30-telamont/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  requirements.txt  .env.example  .gitignore
  app/
    main.py          # FastAPI app, routes, static mount
    db.py            # engine, session, create_all
    models.py        # SQLModel tables
    extract.py       # pypdf/text extraction + chunking
    retrieval.py     # BM25 index per project
    llm.py           # provider abstraction (anthropic + mock)
    pipeline.py      # two-stage detection, ask, notice
    static/index.html
  scripts/make_sample_docs.py   # generates sample_docs/*.pdf with reportlab
  sample_docs/       # 3 generated PDFs committed (small)
  tests/test_extract.py  tests/test_pipeline_mock.py  tests/test_api.py
```

## 11. Sample documents (generated by `scripts/make_sample_docs.py`, committed)

Three realistic 1–3 page PDFs for a fictional project "Maple Street Community Center" with planted conflicts:
1. `01_prime_contract.pdf` — AIA-style excerpt: substantial completion **180 calendar days**; liquidated damages **$1,500/day**; retainage **10%**; notice of delay within **7 days**; warranty **1 year**; order-of-precedence clause (Contract > Specifications > Drawings); a **pay-when-paid** clause.
2. `02_specifications_div03.pdf` — Division 03 concrete: footings **4,000 psi** at 28 days; slabs **3,500 psi**; air entrainment 6%; submittals within **14 days**; warranty **2 years** on structural concrete.
3. `03_drawing_notes_S-001.pdf` — structural general notes: all concrete **3,000 psi** unless noted; rebar Grade 60; schedule milestone: substantial completion **210 calendar days**; reference to a non-existent spec section 03 30 00 revision C.

The mock pipeline must detect at least: concrete strength contradiction (spec vs drawings), substantial completion contradiction (contract vs drawing notes), warranty contradiction (contract vs spec), notice period contradiction (7 vs 14 days), and the pay-when-paid single-document risk.

## 12. Acceptance checks (must all pass; run them, do not assume)

1. `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` completes.
2. `python scripts/make_sample_docs.py` writes the three PDFs into `sample_docs/`.
3. `pytest -q` passes (≥ 8 tests: extraction of a generated PDF, chunking never crosses pages, mock stage 1 finds `concrete_compressive_strength` cards, mock stage 2 emits ≥ 4 contradictions on the sample set, API create project → upload 3 PDFs → detect returns ≥ 5 risks with ≥ 1 contradiction having 2 citations from 2 different documents, PATCH status works, ask returns ≥ 1 citation, notice returns non-empty text, health endpoint reports provider).
4. `uvicorn app.main:app --port 8000` boots with no API key; `curl localhost:8000/api/health` → `{"ok":true,"llm_provider":"mock",...}`; `curl localhost:8000/` returns the UI HTML.
5. End-to-end with curl against the running server: create project, upload the 3 sample PDFs, detect, list risks, patch one to `in_review`, ask "What concrete strength is required for footings?", draft a notice — all return 200 with the expected shapes.
6. With `LLM_PROVIDER=anthropic` and no key set, `/api/health` still works and `/detect` returns a clear 400 error, not a stack trace.
7. The UI works in a browser: verify by loading `/` with Playwright (pre-installed; `require('playwright')` / `from playwright.sync_api import sync_playwright`) and checking that the project creation form renders and that after the API has data the board shows risks. A screenshot saved to `docs/screenshot.png` is a plus.

## 13. README requirements

What Telamont does (with links above), what Girder does and skips, architecture summary (the two-stage pipeline), the GitHub tools table, exact setup/run steps (including mock mode and sample docs), environment variables, known limitations (text-only PDFs, lexical retrieval, single-user), and the next 3 things to build (drawing/vision support for sheets, revision diffing, Procore webhook sync). State assumptions made.

```
