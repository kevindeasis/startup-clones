# IR Desk — a learning clone of Collar AI

**Independent learning clone, not affiliated with Collar AI or its founders.** All demo data (Northwind Robotics, NWR) is fictional.

## The original
[Collar AI](https://usecollarai.com) (YC F26) builds AI for public-company investor relations teams: investor targeting, live earnings-call Q&A support with citations, a self-updating IR CRM, an "IR front desk" that answers investors from disclosed documents only, and announcement modeling.

## What this clone does
1. **Document library + ingest** (`/docs-library`): upload PDF/DOCX/XLSX/TXT/MD, chunked (~800 chars, 100 overlap, page/section labels) into SQLite; toggle public flag; delete. "Load demo company" seeds 5 docs and 8 investors.
2. **Live Q&A assist** (`/qa`, `POST /api/qa`): BM25 retrieval, JSON answer with confidence, citations, disclosure-risk flags, follow-ups. Off-topic gives "Not covered by disclosed materials — defer". Server validates that every number in the answer appears in a cited chunk, otherwise adds a warning.
3. **IR front desk** (`/desk`, `POST /api/desk`): only documents with `public=true` are retrievable; polite refusal otherwise; per-session history held in memory.
4. **IR CRM from call notes** (`/notes`, `/investors`, `POST /api/notes`): extracts investor, attendees, topics, sentiment, concerns, next steps (owner, due); upserts the investor, appends an interaction.
5. **Investor targeting** (`/targeting`, `GET /api/targeting`): deterministic 100-point score (style 30, sector 30, AUM band 15, recency 10, existing holder 8, meeting history 7) plus a 2-sentence rationale per investor.

**Skipped:** auth, billing, multi-tenant, FactSet/Bloomberg/Q4 integrations, audio/live transcription, stock-reaction modeling (`POST /api/announcement-model` returns 501).

## Architecture
FastAPI + Jinja2 pages with a little vanilla JS (no build step); SQLite via stdlib `sqlite3`; `app/ingest.py` (parse + chunk), `app/retrieval.py` (rank-bm25 plus an overlap relevance gate), `app/llm.py` (`complete_json`, JSON extraction + one retry, mock switch), `app/qa.py`, `app/notes.py`, `app/targeting.py`, `app/demo.py`. Mock mode (no `ANTHROPIC_API_KEY`, or `MOCK_LLM=1`) is deterministic: Q&A returns the best-matching sentences with real citations, notes use regex/keyword heuristics, rationales are templated. A "mock mode" badge shows in the UI.

## GitHub tools / libraries used
`anthropic`, `fastapi`, `uvicorn`, `pydantic`, `rank-bm25`, `pypdf`, `python-docx`, `openpyxl`, `jinja2`, `python-multipart`, `pytest`, `httpx`.

## Setup and run
```bash
python3 -m venv /tmp/irdesk-venv
/tmp/irdesk-venv/bin/pip install -r requirements.txt
cp .env.example .env        # optional; export the vars yourself, the app does not auto-load .env
/tmp/irdesk-venv/bin/uvicorn app.main:app --port 8000
# open http://127.0.0.1:8000, click "Load demo company"
/tmp/irdesk-venv/bin/python -m pytest -q
```

## Environment variables
| Var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | unset means mock mode |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model for real mode |
| `MOCK_LLM` | `0` | `1` forces mock mode |
| `DATABASE_PATH` | `./irdesk.db` | SQLite file |
| `PORT` | `8000` | pass to `uvicorn --port` yourself |

## Known limitations
- The real-LLM path (`complete_json`, prompts) was NOT exercised: no API key was available. Only mock mode was verified.
- Mock Q&A is extractive, mock notes extraction is heuristic (e.g. investor name regex expects "Meeting/Call with <Name>").
- BM25 is rebuilt on every query (fine for small libraries); no embeddings.
- Number validation is a string match on numerals, so it does not catch spelled-out numbers or unit changes.
- Front-desk history is in memory and lost on restart; no auth or rate limiting; single company profile hard-coded in `app/config.py`.
- Uploaded scanned PDFs without a text layer are rejected (no OCR).

## Next 3 things to build
1. Real-LLM integration tests (recorded fixtures) and a hybrid BM25 + embedding retriever.
2. Editable fund-profile CSV import and configurable company profile / score weights for targeting.
3. Auto-drafted follow-up emails from CRM next steps, plus a basic announcement-impact model.
