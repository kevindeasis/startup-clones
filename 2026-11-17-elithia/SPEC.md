# SPEC — "Chronolog": an Elithia clone (2026-11-17)

Independent learning clone of **Elithia** (YC F26, https://elithia.com, YC page https://www.ycombinator.com/companies/elithia).
Not affiliated with Elithia.

## What the original does
Elithia sells "agents for the medical review behind every claim". Physician expert witnesses, medico-legal
agencies and (next) law firms receive thousands of pages of disorganized medical records for malpractice,
birth-injury, nursing-home and catastrophic-injury claims. Elithia's agents:
1. **Paginate**: remove blank and duplicate pages, categorise, sort and date loose files into structured documents.
2. **Build a chronology**: a clean, verified timeline of clinical events, where *every finding is cited to its source page*.
3. **Human-in-the-loop review**: inline editing, verification, "shows you the pages".
4. **Export** to Word and PDF, adapted to the firm's report structure and branding.
"Elithia does the reading. The judgment stays with the expert."

## What the clone builds ("Chronolog")
A local web app: upload a bundle of medical-record PDFs for a case → the app paginates (blank/duplicate removal,
per-page classification and dating, grouping into documents, chronological ordering) → extracts a cited
chronology of clinical events with an LLM → the reviewer verifies/edits events against the source pages →
exports a branded DOCX/PDF report. Must run fully offline in **mock mode** when no API key is present.

## Stack (exact)
- **Python 3.11+**, **FastAPI** + **uvicorn** (API + server-rendered HTML with **Jinja2** templates, vanilla JS, no build step).
- **PyMuPDF (`pymupdf`)**: PDF page text extraction, page-to-PNG rendering for the "show me the page" viewer, blank-page detection (text length + pixel ink ratio).
- **rapidfuzz**: near-duplicate page detection (`fuzz.ratio` on normalised page text ≥ 97 → duplicate).
- **anthropic** (official Python SDK): LLM calls (classification + event extraction) with structured JSON output.
- **python-docx**: DOCX export. **reportlab**: PDF export AND generating the synthetic sample record bundle.
- **sqlite3** (stdlib): persistence in `data/chronolog.db`. Uploaded files and rendered page PNGs under `data/`.
- **pytest** + **httpx** (FastAPI TestClient): tests. **python-multipart** for uploads. **pydantic** for schemas.
- Do NOT add Docling, LangChain, a JS build chain, auth, billing or a vector DB.

## Environment variables (`.env.example`, read via `os.environ`)
- `ANTHROPIC_API_KEY` — optional. If missing/empty → **mock mode** (deterministic heuristic extractor), app must still work end to end.
- `ANTHROPIC_MODEL` — default `claude-sonnet-5-5` (current Sonnet; good price/latency for per-batch extraction).
- `LLM_MODE` — `auto` (default: live if key present else mock) | `mock` | `live`.
- `PORT` — default 8000. `DATA_DIR` — default `./data`.
- `/health` returns `{"status":"ok","mode":"mock"|"live","model":...}`.

## Core user flows (implement all five)
1. **Create case & upload records**: `/` lists cases; "New case" (name, client/claimant, matter type, firm branding: firm name, report title, footer line). Upload one or more PDFs (multi-file). A **"Load sample bundle"** button generates (with reportlab, in `scripts/make_sample_records.py`, also runnable standalone) a deliberately messy ~30-page bundle: 3–4 PDFs from different facilities, out of order, with 2+ exact-duplicate pages, 1+ near-duplicate (re-scanned) page, 2+ blank pages, dates in several formats (`03/14/2024`, `March 14, 2024`, `2024-03-14`, `14 Mar 2024`), a few conflicting facts (e.g. two notes giving different dates for the same surgery, allergy listed as "NKDA" in one note and "penicillin" in another), and document types: ED triage note, admission H&P, operative report, nursing notes, discharge summary, radiology report, lab results, pharmacy MAR, physio note, GP letter. Seed a case with this bundle on first run so the UI is never empty.
2. **Paginate** (`POST /cases/{id}/paginate`): split every PDF into pages; store text; flag blank pages; flag duplicates (exact hash and rapidfuzz near-dupes, keep the first occurrence as canonical); classify each kept page via LLM in batches of ~10 pages → `{doc_type, facility, provider, service_date (ISO or null), page_role: first|continuation, confidence}`; group consecutive same-doc pages into **documents**; order documents by `service_date` (undated documents at the end, flagged); assign sequential **Bates-style numbers** `CHR-000001…` in the final order. Screen `/cases/{id}/pages`: the ordered document list with original file/page refs, type, date, confidence; blank/duplicate pages shown struck through with their reason; per-page thumbnail (`GET /pages/{page_id}.png`) and text.
3. **Build chronology** (`POST /cases/{id}/chronology`): for each document (batched by ~6k chars of text with page markers `[[PAGE CHR-000012]]`), ask the LLM for clinical events as strict JSON: `{date, time|null, facility, provider, category (visit|imaging|lab|medication|procedure|diagnosis|nursing|discharge|correspondence|other), summary (≤2 sentences), significance (low|medium|high), source_pages:[bates…], quote (≤200 chars verbatim)}`. Reject any event whose `source_pages` are not in the batch. Merge all events, sort by date/time, then run a **conflict pass**: same-day or same-topic events with contradictory facts (the LLM is given the sorted events list and returns `conflicts: [{event_ids, description}]`; in mock mode, a heuristic flags duplicate procedure names with different dates and allergy mismatches). Progress is shown in the UI (poll `GET /cases/{id}/status`).
4. **Review** (`/cases/{id}`): the chronology table (date, category, facility/provider, summary, significance, citations). Clicking a citation opens a side panel with the rendered page image + extracted text + the verbatim quote highlighted. Each event has: inline edit (date, summary, significance), **Verify** toggle (`verified_by`, `verified_at`), delete, and "Add event" manually. Conflicts list at the top with "resolve" (dismiss with note). Summary stats: pages in, blanks removed, duplicates removed, documents, events, % verified.
5. **Export** (`GET /cases/{id}/export.docx`, `GET /cases/{id}/export.pdf`): branded report: cover (firm name, report title, case name, prepared date, "Draft — pending expert sign-off" unless 100% verified), summary stats, **paginated record index** (Bates range, doc type, facility, date), the **chronology table** with a citations column (`CHR-000012`), an **unresolved conflicts** section, and the footer line. Both files must open (python-docx re-open check; PyMuPDF opens the PDF and finds ≥ 3 pages).

## LLM pipeline design
- `app/llm.py` exposes `classify_pages(batch) -> list[PageClass]`, `extract_events(doc_batch) -> list[Event]`, `find_conflicts(events) -> list[Conflict]`. One `LLMClient` with `MockLLM` and `AnthropicLLM` implementations chosen by `LLM_MODE`.
- Anthropic calls: `client.messages.create(model=ANTHROPIC_MODEL, max_tokens=4000, system=..., messages=[...])`, ask for **JSON only**, parse defensively (strip code fences, retry once on invalid JSON). Log each call (purpose, input chars, output chars, latency) to table `llm_runs` and show the count on the case page.
- Prompts (in `app/prompts.py`): system prompt = "You are a medical-records analyst for medico-legal review… Never infer facts not on the page. Every event must cite the page marker it came from. Return JSON only." Include the schema and 1 worked example.
- **MockLLM** must be deterministic and useful: classify by keyword rules (e.g. "OPERATIVE REPORT" → procedure/operative report), extract dates with a regex covering the four formats above, build one event per dated paragraph/section with the first sentence as summary and the page as citation, flag conflicts via the heuristics above. Tests run in mock mode.

## Data model (SQLite)
`cases(id, name, claimant, matter_type, firm_name, report_title, footer, created_at, status)`;
`files(id, case_id, filename, path, page_count, uploaded_at)`;
`pages(id, case_id, file_id, page_index, text, text_hash, is_blank, is_duplicate, duplicate_of, dup_reason, doc_type, facility, provider, service_date, page_role, confidence, document_id, bates, png_path)`;
`documents(id, case_id, doc_type, facility, provider, service_date, bates_start, bates_end, order_index, undated)`;
`events(id, case_id, document_id, date, time, facility, provider, category, summary, significance, quote, source_pages (json), verified, verified_by, verified_at, created_by (llm|user), updated_at)`;
`conflicts(id, case_id, event_ids (json), description, resolved, resolution_note)`;
`llm_runs(id, case_id, purpose, model, mode, input_chars, output_chars, latency_ms, created_at)`.

## Screens / endpoints
`GET /` cases list + new case form · `POST /cases` · `GET /cases/{id}` review screen · `POST /cases/{id}/files` upload ·
`POST /cases/{id}/sample` load sample bundle · `POST /cases/{id}/paginate` · `GET /cases/{id}/pages` ·
`POST /cases/{id}/chronology` · `GET /cases/{id}/status` · `GET /pages/{page_id}.png` · `GET /api/pages/{page_id}` (json text+quote) ·
`PATCH /api/events/{id}` · `POST /api/events/{id}/verify` · `DELETE /api/events/{id}` · `POST /api/cases/{id}/events` ·
`POST /api/conflicts/{id}/resolve` · `GET /cases/{id}/export.docx` · `GET /cases/{id}/export.pdf` · `GET /health`.
Keep the UI clean and minimal (one CSS file, light theme is fine); no frameworks.

## Skip
Auth, billing, multi-tenant orgs, GDPR geofencing, OCR of scanned images (text-layer PDFs only; say so in the README), "learns from expert corrections", Word template ingestion.

## Acceptance checks (must all pass; the reviewer will run them)
1. `pip install -r requirements.txt` then `pytest -q` passes in mock mode (no API key) with ≥ 12 tests covering: blank detection, exact + near duplicate detection, date normalisation for all four formats, Bates assignment order, event→page citation validation (event with unknown page rejected), conflict heuristic, DOCX export re-opens, PDF export opens with ≥ 3 pages, `/health` mock, full pipeline on the sample bundle.
2. `uvicorn app.main:app --port 8000` boots with no key; `/health` → mode `mock`; `/` shows the seeded sample case.
3. On the sample case: paginate removes ≥ 2 blanks and ≥ 2 duplicates (one near-dup), creates ≥ 6 documents in chronological order, assigns contiguous Bates numbers; chronology produces ≥ 12 events each with ≥ 1 valid citation; ≥ 1 conflict detected; verify/edit/delete/add work via the API; both exports download and open.
4. The sample bundle generator writes PDFs under `data/` (gitignored); nothing under `data/` is committed. Repo folder stays small (< 1 MB, no binaries except none).
5. README documents setup, env vars, mock vs live mode, limitations, and next steps.
