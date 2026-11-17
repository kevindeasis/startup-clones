# Chronolog - an Elithia clone (2026-11-17)

> Independent learning clone. **Not affiliated with, endorsed by, or derived from Elithia's code.** It is a weekend-style
> reimplementation of the public product idea, built on fictional data. **Nothing here is medical or legal advice.**

## The original: Elithia

[Elithia](https://elithia.com) (YC F26, [YC page](https://www.ycombinator.com/companies/elithia)) sells "agents for the
medical review behind every claim". Physician expert witnesses, medico-legal agencies and (next) law firms receive thousands of
pages of disorganised medical records for malpractice, birth-injury, nursing-home and catastrophic-injury claims. Elithia's agents
(1) paginate the pile (drop blank and duplicate pages, classify, date and sort loose files into structured documents),
(2) build a verified chronology where every finding is cited to its source page, (3) keep a human in the loop (inline edit,
verify, "shows you the pages"), and (4) export Word/PDF reports adapted to the firm's branding.
"Elithia does the reading. The judgment stays with the expert."

## What this clone does ("Chronolog")

A local web app (FastAPI + server-rendered Jinja2 + vanilla JS, no build step):

1. **Cases and upload** - create a case (name, claimant, matter type, firm branding: firm name, report title, footer), upload multiple PDFs, or press **Load sample bundle**. A synthetic ~29-page, 4-PDF messy bundle (fictional patient; out-of-order, 2 exact duplicates, 1 re-scanned near-duplicate, 3 blank pages, four date formats, conflicting surgery date and allergy facts, 10 document types) is generated with reportlab and a case is **seeded with it on first start**.
2. **Paginate** - split PDFs into pages, extract text (paragraph-aware), flag blanks (text length + pixel ink ratio), flag duplicates (exact hash, rapidfuzz near-dupes at ratio >= 97, first occurrence kept), classify kept pages in batches of 10, group into documents, order by service date (undated last, flagged), assign contiguous Bates-style numbers `CHR-000001...`. The `/cases/{id}/pages` screen shows thumbnails and struck-through removed pages with the reason.
3. **Build chronology** - per document, batches of ~6k chars with `[[PAGE CHR-000012]]` markers go to the LLM for strict-JSON events; events citing pages outside the batch are rejected; events are merged and sorted; a conflict pass flags contradictions. Progress is polled from `GET /cases/{id}/status`.
4. **Review** - chronology table, conflicts list (resolve with note), clicking a citation opens a side panel with the rendered page image, extracted text and the verbatim quote highlighted; inline edit (date, summary, significance), Verify toggle (`verified_by`, `verified_at`), delete, add manual event, summary stats incl. % verified and LLM-call count.
5. **Export** - `export.docx` (python-docx) and `export.pdf` (reportlab): cover (firm, title, case, date, "Draft - pending expert sign-off" unless 100% verified), stats, paginated record index (Bates range, type, facility, date), chronology with citations column, unresolved conflicts, footer line.

**Skipped on purpose:** auth, billing, multi-tenant orgs, GDPR geofencing, OCR of scanned images, learning from expert corrections, Word template ingestion, Docling, LangChain, JS build chain, vector DB.

## Architecture

```
app/main.py      FastAPI routes + Jinja2 screens; seeds sample case at startup
app/pipeline.py  paginate_case() and build_chronology() background tasks, progress dict, pure helpers
app/pdfutil.py   PyMuPDF: paragraph-aware text, blank detection, PNG rendering
app/dates.py     find/normalise dates (03/14/2024, March 14, 2024, 2024-03-14, 14 Mar 2024)
app/llm.py       LLMClient -> MockLLM | AnthropicLLM; classify_pages / extract_events / find_conflicts
app/prompts.py   system prompt + JSON schemas + worked examples
app/export.py    DOCX + PDF report builders, stats
app/db.py        sqlite3 schema + helpers (data/chronolog.db)
scripts/make_sample_records.py   reportlab sample bundle generator (also runnable standalone)
tests/           pytest suite (mock mode)
```

**Pipeline stages:** upload -> split + text + blank flag -> exact/near duplicate flag -> LLM classify (batches of 10) -> group into documents -> order by date -> Bates numbers -> (separately) per-document event extraction -> citation validation -> sort -> conflict pass -> human review -> export.

**Data model (SQLite, `data/chronolog.db`):** `cases`, `files`, `pages` (text, hash, blank/duplicate flags, classification, `document_id`, `bates`), `documents` (Bates range, order, undated), `events` (cited `source_pages` JSON, verification fields, `created_by` llm|user), `conflicts`, `llm_runs` (purpose, model, mode, chars in/out, latency). Uploads and page PNGs live under `data/` too.

**Mock vs live LLM:** `LLM_MODE=auto` (default) uses the live `AnthropicLLM` only if `ANTHROPIC_API_KEY` is set, otherwise `MockLLM`. The mock is deterministic: keyword rules for document type (e.g. "OPERATIVE REPORT" -> operative report/procedure), a regex date extractor, one event per dated paragraph (or labelled section such as Allergies/Impression/Plan) with the first sentence as summary, and conflict heuristics (same procedure with different dates; NKDA vs a named drug allergy). The live path calls `client.messages.create(model=ANTHROPIC_MODEL, max_tokens=4000, system=..., messages=[...])`, asks for JSON only, strips code fences, retries once on invalid JSON, and validates citations exactly as the mock does. Every call is logged to `llm_runs`.

## Open-source tools used

| Tool | Used for |
|---|---|
| [FastAPI](https://github.com/fastapi/fastapi) + [uvicorn](https://github.com/encode/uvicorn) | API and server |
| [Jinja2](https://github.com/pallets/jinja) | server-rendered HTML |
| [PyMuPDF](https://github.com/pymupdf/PyMuPDF) | text extraction, page PNG rendering, blank detection, PDF re-open checks |
| [rapidfuzz](https://github.com/rapidfuzz/RapidFuzz) | near-duplicate page detection |
| [anthropic](https://github.com/anthropics/anthropic-sdk-python) | live LLM classification / extraction / conflict pass |
| [python-docx](https://github.com/python-openxml/python-docx) | DOCX export |
| [reportlab](https://docs.reportlab.com/) | PDF export and the synthetic sample records |
| [pydantic](https://github.com/pydantic/pydantic) | schemas and validation |
| [python-multipart](https://github.com/Kludex/python-multipart) | uploads |
| [pytest](https://github.com/pytest-dev/pytest) + [httpx](https://github.com/encode/httpx) | tests (FastAPI TestClient) |

## Setup and run

Requires Python 3.11+.

```bash
cd 2026-11-17-elithia
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional; the app reads real environment variables
uvicorn app.main:app --port 8000
```

Open http://localhost:8000 - the seeded sample case is already listed. Open it, then **Paginate**, **Build chronology**, review, and export.
To use the live model: `export ANTHROPIC_API_KEY=sk-ant-...` (the app reads `os.environ`; it does not auto-load `.env`, so `export` it or use `set -a; . ./.env; set +a`).

Generate the sample PDFs standalone: `python scripts/make_sample_records.py data/sample`.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | If empty -> mock mode |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model for live calls |
| `LLM_MODE` | `auto` | `auto` (live if key present else mock) / `mock` / `live` |
| `PORT` | `8000` | Port to pass to uvicorn (`--port $PORT`) |
| `DATA_DIR` | `./data` | Uploads, page PNGs, SQLite DB (gitignored) |

`GET /health` -> `{"status":"ok","mode":"mock"|"live","model":...}`.

### Tests

```bash
. .venv/bin/activate && pytest -q
```
All tests run in mock mode with a temp `DATA_DIR` (blank, exact/near duplicates, four date formats, Bates order, citation validation, conflict heuristic, live-client retry with a stub, DOCX/PDF export, `/health`, full pipeline on the sample bundle, event CRUD).

### API summary

`GET /` · `POST /cases` · `GET /cases/{id}` · `POST /cases/{id}/files` · `POST /cases/{id}/sample` · `POST /cases/{id}/paginate` (202, background) · `GET /cases/{id}/pages` · `POST /cases/{id}/chronology` (202, background) · `GET /cases/{id}/status` · `GET /pages/{page_id}.png` · `GET /api/pages/{page_id}?event_id=` · `PATCH /api/events/{id}` · `POST /api/events/{id}/verify` (toggles) · `DELETE /api/events/{id}` · `POST /api/cases/{id}/events` · `POST /api/conflicts/{id}/resolve` · `GET /cases/{id}/export.docx|pdf` · `GET /health`.

## Known limitations

- **Text-layer PDFs only. No OCR**: scanned images without a text layer will be classified as blank/unknown.
- The **mock extractor is heuristic** (tuned to the synthetic bundle's layout and wording); it is a stand-in for demos/tests, not a clinical reader.
- The **live Anthropic path is implemented but was not exercised in the build sandbox** (no API key); it is covered only by a stubbed-client unit test. Prompt quality, token limits and cost have not been tuned.
- Editing an event clears its verification (deliberate); re-running pagination wipes documents, events and conflicts.
- Documents on the same date keep file order rather than time-of-day order; no cross-file merging of a document split over two PDFs.
- Background tasks are in-process (progress is in memory); no job queue, no auth, single user.
- Not a medical device; output must be checked by a qualified expert. Not medical or legal advice.

## Next 3 things to build

1. OCR for scanned bundles (e.g. Tesseract/OCRmyPDF, or a vision-model fallback) with per-page confidence surfaced in the UI.
2. Firm report templates: ingest a firm's Word template and map the chronology/index into its structure and styles.
3. Reviewer feedback loop: record expert corrections (edits/deletes) and use them as few-shot examples and a regression eval set; add an eval harness comparing mock/live extraction against gold events.
