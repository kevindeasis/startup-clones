# BUILD_PROMPT.md — verbatim prompts sent to the build subagent

## Round 0 — initial build prompt (model: sonnet, agent type: general-purpose)

You are building a working clone of Hesper AI (YC F26) — an AI insurance-claims investigation tool — inside the folder `/home/claude/startup-clone/2026-10-29-hesper-ai/`. The folder already contains SPEC.md (reproduced in full below). Build exactly per the spec.

## Instructions

- Build the working end-to-end clone inside `/home/claude/startup-clone/2026-10-29-hesper-ai/` exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (FastAPI, Uvicorn, Jinja2, Pydantic v2, Anthropic Python SDK, PyMuPDF, Pillow, fpdf2, python-multipart, pytest) instead of reinventing them.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO `ANTHROPIC_API_KEY` in this environment, so the mock provider (`LLM_PROVIDER=mock`) is what you will verify with; still implement the real Anthropic provider carefully per the spec (Messages API, JSON-only parsing, base64 image blocks, token counts from `response.usage`).
- Add a `.gitignore` appropriate for the stack (data/, .env, __pycache__, .venv, *.pyc, .pytest_cache).
- Verify it: `pip install -r requirements.txt --break-system-packages`, run `pytest -q`, start the app locally with uvicorn in the background and confirm it boots; then exercise the main flow with curl: `POST /api/demo`, `POST /api/claims/{id}/investigate`, poll `GET /api/investigations/{id}` until done, fetch `GET /claims/{id}/report`, and download `export.md`, `export.pdf` (check it starts with %PDF) and `export.json`. Fix errors before finishing. Do not claim it works unless you actually ran it. Stop the background server when finished.
- Generate the sample PDFs in `sample_data/` with `scripts/make_samples.py` (fpdf2) and commit the generated files; make `invoice.pdf` contain two `%%EOF` markers (save, then do an incremental save with PyMuPDF) so forensics has something to flag in the demo.
- Write a thorough `README.md` in the folder: what the original company does (with link https://gethesperai.com and https://www.ycombinator.com/companies/hesper-ai), what this clone does and what it skips, architecture summary, the GitHub tools used (with links), exact setup and run steps, environment variables, known limitations, and the next 3 things to build. State clearly that this is an independent educational clone not affiliated with Hesper AI.
- Do not modify anything outside that folder. Do not create or edit SPEC.md, BUILD_PROMPT.md or BUILD_LOG.md. Do not commit or push (no git commands that change state).
- Report back in your final message: what was built (file list), exactly which verification commands were run and their results (paste the key output lines), anything that does not work or was simplified, and your total input/output token usage as best you can report it.

## SPEC.md (verbatim)

# Build spec — Hesper AI clone ("Claimsleuth")

Date: 2026-10-29. Original company: Hesper AI (YC F26) — https://gethesperai.com — https://www.ycombinator.com/companies/hesper-ai

## 1. What the product does

Hesper AI sells "AI agents that investigate P&C insurance claims end to end" to claims and Special Investigations Unit (SIU) teams at carriers, MGAs and TPAs. An agent reads the claim file (FNOL form, adjuster notes, recorded statements, police reports, invoices, photos, policy documents), detects tampered documents, verifies facts, checks coverage, flags inconsistencies, and produces an "audit-ready" evidence file in minutes. Per the company's FAQ the evidence file contains: an executive summary, a complete evidence package with source documentation, a timeline reconstruction, statement analysis with identified inconsistencies, a coverage position, risk scoring with rationale, and recommended next actions. Every finding is cited to a source document and every decision is logged.

**This clone implements the Investigation stage only**: upload a claim file → automated multi-step LLM investigation → evidence file with citations → export as Markdown/PDF/JSON. It does NOT implement FNOL intake, triage, estimation, settlement, payment or subrogation, and it does not integrate with Guidewire/Duck Creek/etc.

## 2. Core user flows (implement all five)

1. **Create a claim** — user enters claim number, line of business (auto / property / homeowners / liability / workers' comp / pet), claimant name, loss date, short loss description. Claim gets status `open`.
2. **Upload claim documents** — user attaches one or more files to the claim: PDF, PNG/JPG, TXT/MD. Each upload is typed by the user (dropdown: `policy`, `fnol`, `statement`, `police_report`, `medical`, `invoice`, `photo`, `adjuster_notes`, `other`). The app extracts text (PyMuPDF for PDF, plain read for text; images are passed to the vision model as base64, no OCR library) and runs **document forensics** on the file (see §6). Extracted text and forensics are stored per document.
3. **Run investigation** — one button starts the pipeline (§6). Progress is shown step by step (polling an endpoint every ~1.5s; no websockets needed). When finished the claim status becomes `investigated`.
4. **Review the evidence file** — a report page showing: executive summary; risk score (0–100) with rationale and a risk band (low / medium / high / critical); timeline (table sorted by date, each row cites document + quote); statement analysis (claims/assertions extracted per document, and a list of inconsistencies, each with severity, the two conflicting quotes and their source documents); coverage position (covered / not covered / unclear, with the policy clause quoted, or "no policy document uploaded"); document forensics findings; recommended next actions; and a full **decision log** (every pipeline step, timestamp, model used, token counts, and the raw structured output).
5. **Export** — download the evidence file as `.md`, `.pdf` (fpdf2), and `.json`.

Also include a **"Load demo claim"** button on the home page that creates a sample claim and uploads 4 bundled sample documents (a policy excerpt, an FNOL form, a claimant statement, a repair invoice — all plain-text or small generated PDFs in `sample_data/`) whose content contains deliberate inconsistencies (e.g. loss date differs between FNOL and statement; invoice dated before the loss; the policy excludes the stated cause). This makes the whole flow demoable in 30 seconds.

## 3. Stack

- **Python 3.11+**, **FastAPI** (https://github.com/fastapi/fastapi) + **Uvicorn** (https://github.com/encode/uvicorn) for the API and for serving the UI.
- **Jinja2** (https://github.com/pallets/jinja) server-rendered HTML templates + a small amount of vanilla JS (fetch + polling). No frontend build step. Single CSS file, light/dark via `prefers-color-scheme`.
- **SQLite** via the standard library `sqlite3` (no ORM) — one file `data/claimsleuth.db`. Uploaded files stored under `data/uploads/<claim_id>/`.
- **Pydantic v2** (https://github.com/pydantic/pydantic) models for every structured LLM output; validate every model response, retry once on validation failure.
- **Anthropic Python SDK** (https://github.com/anthropics/anthropic-sdk-python) — default provider. Model name from env `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`). Use the Messages API with a JSON-only instruction and parse into the Pydantic model; use image content blocks (base64) for photo documents.
- **PyMuPDF** (`pymupdf`, https://github.com/pymupdf/PyMuPDF) — PDF text extraction, page count, metadata, and incremental-update detection.
- **Pillow** (https://github.com/python-pillow/Pillow) — image EXIF read for photo forensics.
- **fpdf2** (https://github.com/py-pdf/fpdf2) — PDF export of the evidence file, and generating the sample PDFs in `sample_data/`.
- **python-multipart** (https://github.com/Kludex/python-multipart) — file uploads in FastAPI.
- **pytest** (https://github.com/pytest-dev/pytest) + FastAPI `TestClient` for tests.

Use `requirements.txt` (pinned to major versions, e.g. `fastapi>=0.115`, `anthropic>=0.40`, `pymupdf>=1.24`, `fpdf2>=2.7`, `pydantic>=2.5`, `Pillow>=10`, `jinja2>=3.1`, `uvicorn[standard]>=0.30`, `python-multipart>=0.0.9`, `pytest>=8`, `httpx>=0.27`).

## 4. Data model (SQLite)

```
claims(id TEXT PK, claim_number TEXT, line_of_business TEXT, claimant_name TEXT,
       loss_date TEXT, description TEXT, status TEXT  -- open|investigating|investigated|error
       , created_at TEXT, updated_at TEXT)

documents(id TEXT PK, claim_id TEXT FK, filename TEXT, doc_type TEXT, mime TEXT,
          size_bytes INTEGER, storage_path TEXT, extracted_text TEXT,
          page_count INTEGER, forensics_json TEXT, created_at TEXT)

investigations(id TEXT PK, claim_id TEXT FK, status TEXT -- running|done|error
               , current_step TEXT, started_at TEXT, finished_at TEXT,
               report_json TEXT, error TEXT)

decision_log(id INTEGER PK AUTOINCREMENT, investigation_id TEXT FK, step TEXT,
             model TEXT, input_tokens INTEGER, output_tokens INTEGER,
             duration_ms INTEGER, output_json TEXT, created_at TEXT)
```

IDs are `uuid4().hex[:12]`. All timestamps ISO-8601 UTC.

## 5. Screens and endpoints

HTML pages (Jinja2):
- `GET /` — claims list + "New claim" form + "Load demo claim" button.
- `GET /claims/{id}` — claim detail: documents table (type, filename, pages, forensics flags), upload form, "Run investigation" button, link to latest report, live progress area.
- `GET /claims/{id}/report` — evidence file (§2 flow 4). Export buttons.

JSON API:
- `POST /api/claims` → create claim.
- `GET /api/claims`, `GET /api/claims/{id}` (includes documents).
- `POST /api/claims/{id}/documents` (multipart: `file`, `doc_type`) → extract + forensics, return document record.
- `DELETE /api/claims/{id}/documents/{doc_id}`.
- `POST /api/claims/{id}/investigate` → starts pipeline in a FastAPI `BackgroundTasks`; returns `{investigation_id}`. 409 if already running or no documents.
- `GET /api/investigations/{inv_id}` → `{status, current_step, steps_done:[...], report?}` for polling.
- `GET /api/investigations/{inv_id}/export.{md|pdf|json}`.
- `POST /api/demo` → creates demo claim with sample docs, returns claim id.
- `GET /healthz` → `{ok:true, provider:"anthropic"|"mock"}`.

## 6. LLM pipeline design (the "investigation agents")

Implement in `app/pipeline.py` as a sequence of named steps; each step calls the LLM once (except forensics, which is deterministic), validates into a Pydantic model, and appends to `decision_log`. Steps:

1. `forensics` (no LLM) — per document:
   - PDF: metadata `creationDate` vs `modDate` (flag if modified > 1 day after creation or mod < creation), `producer`/`creator` (flag common editors like "Photoshop", "Word", "Canva", "iLovePDF", "Smallpdf" on documents typed `invoice`/`police_report`/`medical`), number of incremental updates (count of `%%EOF` markers > 1 → flag "document was re-saved after creation"), fonts count > 6 on an invoice → flag "unusual number of fonts". Text-layer present or not.
   - Image: EXIF `DateTimeOriginal` vs claim loss date (flag if photo predates loss date or is > 60 days after), `Software` tag present (flag if an editor), missing EXIF entirely → info flag "no EXIF (possibly screenshot or re-encoded)".
   - Text files: no flags, just note.
   Output: list of `{document_id, flag, severity: info|low|medium|high, detail}`.
2. `extract_facts` — one LLM call per document (text docs get the extracted text, images get the image block). Output `DocumentFacts`: `summary`, `parties:[{name, role}]`, `dates:[{date, event, quote}]`, `amounts:[{amount, currency, what, quote}]`, `assertions:[{text, quote, speaker}]`, `locations:[str]`. Every item carries a verbatim `quote` (≤ 200 chars) from the source so the report can cite it.
3. `timeline` — one LLM call with all documents' `dates` → `Timeline`: `events:[{date, event, document_id, quote, confidence}]` sorted by date, with `gaps_or_anomalies:[str]` (e.g. invoice dated before loss).
4. `inconsistencies` — one LLM call with all `assertions` + `dates` + `amounts` + claim metadata → `InconsistencyReport`: `inconsistencies:[{title, severity: low|medium|high, claim_a:{document_id, quote}, claim_b:{document_id, quote}, explanation}]`, `corroborations:[{fact, document_ids}]`.
5. `coverage` — only if at least one `policy` document exists; one LLM call with policy text + loss description + facts → `CoveragePosition`: `position: covered|not_covered|partially_covered|unclear`, `clauses:[{clause_quote, document_id, effect: grants|excludes|limits|condition}]`, `rationale`, `open_questions:[str]`. Without a policy doc, set `position: "unclear"`, rationale "No policy document uploaded".
6. `risk_and_actions` — one LLM call with forensics flags + inconsistencies + coverage + timeline anomalies → `RiskAssessment`: `score 0–100`, `band`, `rationale:[str]` (each referencing a finding), `recommended_actions:[{action, priority: now|soon|later, why}]`, `executive_summary` (≤ 150 words, plain English, no speculation beyond the evidence).

Compose the final `EvidenceFile` = claim + documents (with forensics) + steps 2–6 + decision log, store as `report_json`.

Prompting rules: a shared system prompt ("You are a P&C claims investigation assistant. You only state what the documents support, you quote verbatim, you never invent facts, you return JSON only matching the given schema."). Include the JSON schema (`Model.model_json_schema()`) in the user message. Strip code fences before parsing. On `ValidationError`, re-ask once with the error text appended. Cap each document's text at ~12,000 characters (truncate with a note).

**Provider abstraction** (`app/llm.py`): `complete_json(system, user_blocks, schema_model) -> model_instance` with two implementations chosen by env `LLM_PROVIDER` (`anthropic` default when `ANTHROPIC_API_KEY` is set; otherwise falls back to `mock` and logs a warning). The **mock provider** must produce *plausible, schema-valid* outputs derived deterministically from the input text (e.g. regex dates/amounts from the text for facts; the demo-claim inconsistencies found by simple heuristics) so the full flow, UI and exports can be exercised and tested without a key. Record `input_tokens`/`output_tokens` from the API response (mock: estimate `len(text)//4`).

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real investigations
ANTHROPIC_MODEL=claude-sonnet-4-5
LLM_PROVIDER=                 # anthropic | mock (auto: anthropic if key set, else mock)
DATA_DIR=./data
MAX_UPLOAD_MB=15
PORT=8000
```

Load with `os.environ` (optionally python-dotenv if present; do not require it).

## 8. Skip

No auth, no multi-tenant, no billing, no admin, no integrations with claims systems, no OCR library (images go straight to the vision model), no websockets, no JS framework, no Docker required (a Dockerfile is a nice-to-have only).

## 9. Project layout

```
2026-10-29-hesper-ai/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  requirements.txt  .env.example  .gitignore  run.sh
  app/__init__.py  app/main.py (FastAPI app, routes)  app/db.py  app/models.py (Pydantic)
  app/llm.py (providers)  app/pipeline.py  app/forensics.py  app/extract.py (text extraction)
  app/export.py (md/pdf/json)  app/demo.py (demo claim loader)
  app/templates/*.html  app/static/style.css  app/static/app.js
  sample_data/ (policy.txt, fnol.pdf, statement.txt, invoice.pdf  — generate the PDFs with a script scripts/make_samples.py and commit the outputs)
  tests/test_api.py  tests/test_forensics.py  tests/test_pipeline_mock.py
```

## 10. Acceptance checks (all must pass with `LLM_PROVIDER=mock`, no API key)

1. `pip install -r requirements.txt` succeeds on Python 3.11–3.13.
2. `pytest -q` passes (≥ 8 tests) covering: create claim; upload txt + pdf + png; forensics flags on a PDF with 2 `%%EOF` markers and on an image without EXIF; full mock investigation completes with `status=done` and a report containing ≥ 1 inconsistency for the demo claim; md/pdf/json exports return 200 with correct content-types; `/healthz`.
3. `uvicorn app.main:app --port 8000` boots; `curl localhost:8000/healthz` → `{"ok":true,...}`.
4. `curl -X POST localhost:8000/api/demo` → claim id; `POST /api/claims/{id}/investigate` → investigation id; polling `GET /api/investigations/{id}` reaches `status: done` within 60s in mock mode; report has executive_summary, timeline.events (≥ 3), inconsistencies (≥ 1), coverage.position, risk.score, recommended_actions (≥ 2), decision_log (≥ 5 entries).
5. `GET /claims/{id}/report` renders HTML containing the executive summary and the inconsistency titles.
6. `export.pdf` is a valid PDF (starts with `%PDF`).
7. No secrets committed; `.env.example` present; `.gitignore` covers `data/`, `.env`, `__pycache__`, `.venv`, `*.pyc`.
8. README documents the above plus the real-provider instructions.

