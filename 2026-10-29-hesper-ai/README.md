# Claimsleuth - an independent clone of Hesper AI's claim-investigation agent

> **Independent educational clone. Not affiliated with, endorsed by, or derived from the code of Hesper AI.** Built from public descriptions of the product only.

## The original company

[Hesper AI](https://gethesperai.com) (YC F26, [YC profile](https://www.ycombinator.com/companies/hesper-ai)) sells "AI agents that investigate P&C insurance claims end to end" to claims and Special Investigations Unit (SIU) teams at carriers, MGAs and TPAs. An agent reads the whole claim file (FNOL, adjuster notes, recorded statements, police reports, invoices, photos, policy documents), detects tampered documents, verifies facts, checks coverage, flags inconsistencies and produces an audit-ready evidence file in minutes, with every finding cited to a source and every decision logged.

## What this clone does (Investigation stage only)

1. Create a claim (number, line of business, claimant, loss date, description).
2. Upload documents (PDF, PNG/JPG, TXT/MD), each typed (policy, fnol, statement, police_report, medical, invoice, photo, adjuster_notes, other). Text is extracted with PyMuPDF and deterministic **document forensics** run immediately.
3. Run a 6-step investigation pipeline with live progress (polling every 1.5 s): `forensics` -> `extract_facts` (one LLM call per document) -> `timeline` -> `inconsistencies` -> `coverage` -> `risk_and_actions`.
4. Review the evidence file: executive summary, risk score + band, cited timeline, statement analysis with two-quote inconsistencies, coverage position with quoted clauses, forensics flags, recommended actions, and a full decision log (step, model, tokens, duration, raw structured output).
5. Export as Markdown, PDF (fpdf2) or JSON.

A **Load demo claim** button creates a homeowners water-damage claim with 4 bundled documents containing deliberate problems: loss date differs between FNOL and statement, the invoice predates the loss, estimate vs invoice total mismatch, FNOL says burst pipe while the statement says seepage after rain (which the policy excludes), and the invoice PDF has two `%%EOF` markers and an editor in its metadata.

**Skipped on purpose:** FNOL intake, triage, estimation, settlement, payment, subrogation, integrations with Guidewire/Duck Creek etc., auth, multi-tenancy, billing, OCR (images go straight to the vision model), websockets, any JS framework.

## Architecture

```
Browser (Jinja2 pages + vanilla JS polling)
   |
FastAPI app/main.py  --BackgroundTasks-->  app/pipeline.py
   |                                          |- app/forensics.py  (PyMuPDF, Pillow; no LLM)
   |                                          |- app/llm.py        (Anthropic | mock provider, JSON parse, retry-once)
   |                                          |     \- app/mock_llm.py (deterministic heuristics, no key needed)
   |                                          \- app/models.py     (Pydantic v2 schemas for every LLM output)
SQLite (stdlib) data/claimsleuth.db      app/export.py (md / pdf / json)      uploads in data/uploads/<claim_id>/
```

- `app/db.py` plain `sqlite3`, tables `claims`, `documents`, `investigations`, `decision_log`. IDs are `uuid4().hex[:12]`, timestamps ISO-8601 UTC.
- `app/llm.py`: `complete_json(system, user_blocks, schema_model)` returns a validated Pydantic instance; `complete_json_with_usage` also returns `(model, input_tokens, output_tokens)` (used by the pipeline for the decision log). The user message includes `Model.model_json_schema()`; code fences are stripped; on `ValidationError` the model is re-asked once with the error appended. Documents are truncated to ~12,000 characters. Images are sent as base64 `image` content blocks. Real token counts come from `response.usage`; the mock estimates `len(text)//4`.
- Provider selection: `LLM_PROVIDER=anthropic|mock`; if empty, `anthropic` when `ANTHROPIC_API_KEY` is set, otherwise `mock` with a logged warning.
- The final `EvidenceFile` JSON is stored in `investigations.report_json` and rendered by `report.html` and `export.py`.

## GitHub tools used

- [FastAPI](https://github.com/fastapi/fastapi) and [Uvicorn](https://github.com/encode/uvicorn) - API and server
- [Jinja2](https://github.com/pallets/jinja) - server-rendered templates
- [Pydantic](https://github.com/pydantic/pydantic) - structured output validation
- [anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python) - Messages API
- [PyMuPDF](https://github.com/pymupdf/PyMuPDF) - PDF text, metadata, fonts
- [Pillow](https://github.com/python-pillow/Pillow) - EXIF
- [fpdf2](https://github.com/py-pdf/fpdf2) - PDF export and sample PDFs
- [python-multipart](https://github.com/Kludex/python-multipart) - uploads
- [pytest](https://github.com/pytest-dev/pytest) (+ [httpx](https://github.com/encode/httpx) for `TestClient`)

## Setup and run

Requires Python 3.11+ (developed on 3.13).

```bash
cd 2026-10-29-hesper-ai
python -m venv .venv && source .venv/bin/activate     # optional
pip install -r requirements.txt                        # add --break-system-packages if installing system-wide
cp .env.example .env                                   # then edit; leave the key empty to use the mock
./run.sh                                               # or: uvicorn app.main:app --port 8000
```

Open http://localhost:8000, click **Load demo claim**, then **Run investigation**.

Tests (mock provider, no key needed): `pytest -q`

Regenerate the sample PDFs: `python scripts/make_samples.py`

### Using the real Anthropic provider

Set `ANTHROPIC_API_KEY=sk-ant-...` in `.env` (optionally `ANTHROPIC_MODEL`). `GET /healthz` should then report `"provider":"anthropic"`. The real provider was implemented per the Messages API but **has not been exercised end to end** (no key was available when this was built); only the mock path was run.

### Curl walkthrough

```bash
CID=$(curl -s -X POST localhost:8000/api/demo | python -c 'import sys,json;print(json.load(sys.stdin)["claim_id"])')
IID=$(curl -s -X POST localhost:8000/api/claims/$CID/investigate | python -c 'import sys,json;print(json.load(sys.stdin)["investigation_id"])')
curl -s localhost:8000/api/investigations/$IID            # poll until "status":"done"
curl -s -o e.pdf localhost:8000/api/investigations/$IID/export.pdf
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Needed for real investigations |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model name |
| `LLM_PROVIDER` | auto | `anthropic` or `mock` (auto: anthropic if key set, else mock) |
| `DATA_DIR` | `./data` | SQLite DB and uploads |
| `MAX_UPLOAD_MB` | `15` | Upload size limit (413 above) |
| `PORT` | `8000` | Used by `run.sh` |

`python-dotenv` is optional; `run.sh` sources `.env` itself.

## Known limitations

- The mock "LLM" is regex/heuristic based and tuned to the demo claim; it is for exercising the app, not real analysis.
- The Anthropic path is untested against the live API; quotes are not programmatically verified to be verbatim in the source text.
- Forensics are simple heuristics (PDF dates/producer/`%%EOF` count/fonts, EXIF) and will produce false positives and negatives. Photos are analysed only by the vision model plus EXIF; no pixel-level tamper detection.
- Pipeline runs in a FastAPI background task inside the web process (no queue, lost on restart, so an interrupted investigation stays `running` and blocks new ones with 409).
- Documents are truncated to ~12k characters; large files are not chunked. Scanned PDFs without a text layer are not OCR'd.
- No auth; the PDF export uses core fonts (non-Latin-1 characters become `?`). Single SQLite file, no migrations.

## Next 3 things to build

1. Verbatim-quote verification: reject or flag any model quote not found in the source text, and highlight citations in a document viewer.
2. Stronger forensics: image error-level analysis / metadata cross-checks, PDF font and object-level diffing between incremental revisions, and external fact checks (weather, address, vendor).
3. Robust job handling and auth: a persistent job queue with resume/cancel, per-user accounts, and an audit trail of human reviewer edits to the evidence file.
