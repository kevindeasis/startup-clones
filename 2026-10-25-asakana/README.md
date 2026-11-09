# OrderDesk - an independent clone of Asakana's AI order desk

> **Independent educational clone. Not affiliated with, endorsed by, or derived from code of Asakana.**
> Built from public descriptions only, as a learning exercise (2026-10-25).

## The original company

[Asakana](https://www.asakana.co/) (YC F26 - [YC profile](https://www.ycombinator.com/companies/asakana)) sells an AI order desk to food distributors (live at US seafood distributors). Restaurants send orders by email, text, WhatsApp, voicemail or a photo of a handwritten note, and someone at the distributor retypes each one into the ERP. Asakana reads the messy message, resolves shorthand ("2 cs hamachi", "same as last Friday"), matches each line to the distributor's catalog, creates a draft order in the ERP, routes anything unclear to a human reviewer, and sends the rep a one-line summary of what was entered and what to watch.

## What this clone does

A local web app implementing the core loop end to end:

inbound message (pasted text, `.eml`, PDF, photo) -> LLM extraction -> fuzzy catalog + customer-alias matching -> confidence routing (auto vs. review) -> review UI -> push to a mock ERP (JSON + CSV) -> rep summary -> learning loop (reviewer corrections become customer aliases).

1. **Intake** (`/intake`): paste text, pick channel/customer (or let it infer from sender email/phone/signature), optionally attach `.png/.jpg/.pdf/.eml`, or load one of 5 samples.
2. **Pipeline**: context (customer profile, aliases, last 3 orders, 40-SKU catalog, today) -> LLM tool-call to an `ExtractedOrder` -> alias hit = 1.0, else RapidFuzz `WRatio` over SKU names + global aliases with a unit sanity check, top-3 candidates -> "same as last Friday / the usual" copies lines from the customer's past ERP order (`source="history"`) -> routing: `auto_approved` only if all lines >= 0.90, customer known and the LLM raised no questions.
3. **Review queue / order page**: status filter, badges, flagged-line counts; two-pane detail with the original message/photo and an editable line table (HTMX saves per field), confidence bars, yellow callout for LLM questions.
4. **Push to ERP**: writes `ErpOrder` + `ErpOrderLine`, marks the draft `pushed`, generates a `RepSummary` (`/summaries`); `/erp/orders` (JSON) and `/erp/orders.csv`.
5. **Learning loop**: changing a line's SKU upserts a `CustomerAlias`; the same shorthand from that customer then matches at 100%. `/customers/{id}` lists/deletes aliases and shows order history.

### What it skips

Auth, billing, multi-tenancy; real ingestion (Gmail, Twilio SMS, WhatsApp); real ERP connectors (QuickBooks, Sage, Zoho); voicemail/speech; background jobs/queues (the pipeline runs synchronously in the request); credit memos, returns, collections, upsell workflows; any admin UI (catalog/customers come from the seed script).

## Architecture

```
 browser (Jinja2 + HTMX)
        |
   app/main.py  FastAPI routes, file ingestion (.eml / pypdf / Pillow)
        |
   app/pipeline.py --> app/llm.py --> Anthropic (tool_use submit_order)
        |                  \--> app/llm_mock.py (deterministic, offline)
        |--> app/matching.py (normalize, RapidFuzz WRatio, aliases)
        |--> app/erp.py (mock ERP push, CSV/JSON export, rep summary)
        v
   app/models.py + app/db.py  SQLModel / SQLite (orderdesk.db)
```

## GitHub tools used

| Library | Repo | Used for |
|---|---|---|
| FastAPI | https://github.com/fastapi/fastapi | HTTP app, routing, forms + uploads |
| SQLModel | https://github.com/fastapi/sqlmodel | ORM + SQLite data model |
| HTMX | https://github.com/bigskysoftware/htmx | Inline line edits (vendored `app/static/htmx.min.js`, v2.0.4) |
| Jinja2 | https://github.com/pallets/jinja | Server-rendered templates |
| Anthropic Python SDK | https://github.com/anthropics/anthropic-sdk-python | LLM extraction (text + vision, forced tool use) |
| RapidFuzz | https://github.com/rapidfuzz/RapidFuzz | Fuzzy catalog matching |
| pypdf | https://github.com/py-pdf/pypdf | PDF text extraction |
| Pillow | https://github.com/python-pillow/Pillow | Image validation/resizing, sample photo generation |
| uvicorn | https://github.com/Kludex/uvicorn | ASGI server |
| pytest + httpx | https://github.com/pytest-dev/pytest, https://github.com/encode/httpx | Tests via TestClient |
| ReportLab | https://github.com/MrBitBucket/reportlab-mirror | Generates the sample PDF in the seed script |

## Setup and run

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional; leave ANTHROPIC_API_KEY empty for mock mode
python -m app.seed              # creates orderdesk.db + files in samples/ (use --reset to rebuild)
pytest -q                       # 18 tests
uvicorn app.main:app --port 8000
```

Open http://localhost:8000/intake, pick a sample from "Load sample", click **Run pipeline**, review, then **Approve & push to ERP** and look at `/summaries` and `/erp/orders.csv`.
To use the real model: set `ANTHROPIC_API_KEY` in `.env` (and optionally `LLM_PROVIDER=anthropic`).

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | If empty the app runs with the mock provider |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Model for extraction |
| `LLM_PROVIDER` | empty (auto) | `anthropic`, `mock`, or empty = anthropic when a key is set |
| `DATABASE_URL` | `sqlite:///./orderdesk.db` | SQLModel database URL |
| `AUTO_APPROVE_THRESHOLD` | `0.90` | Min per-line confidence for `auto_approved` |
| `UPLOAD_DIR` | `./uploads` | Where uploaded photos/PDFs are stored |

## Assumptions and notes

- Mock mode is regex-based and deliberately simple; it handles the seeded samples (English/Spanish, tables, `x2` trailing quantities, "same as last Friday", weekday/tomorrow dates). A photo in mock mode returns a fixed sample extraction with a "requires ANTHROPIC_API_KEY" question, so it always needs review.
- Customer is inferred (in order) from the selected customer, sender email/phone, then the customer name in the text/LLM hint. Without a customer a draft cannot be auto-approved or pushed; assign one on the order page.
- Global product aliases hit at 0.95 (exact name 0.98); if the top two SKUs score within 3 points, confidence is capped at 0.85 to force review. History-copied lines are 0.85 so a human always confirms them.
- Lines the reviewer fixes become confidence 1.0 and the line's `product_text` is the alias key. Only an actual SKU *change* creates an alias (confirming the suggested SKU does not). Setting qty to 0 drops a line on push.
- If the Anthropic call raises, the pipeline falls back to the mock extraction and adds a question so the draft goes to review.
- The Anthropic path is verified only through unit tests with a mocked SDK (no API key was available while building); real-model quality and vision input are untested.
- Datetimes are naive UTC. The "last Friday" lookup uses each ERP order's delivery date (or created date) weekday.
- `htmx.min.js` was fetched from the npm tarball `htmx.org@2.0.4` because unpkg was blocked in the build sandbox.

## Known limitations

- No migrations; schema changes need `python -m app.seed --reset` (drops all data).
- SKU select is a native dropdown (suggested + full catalog), not a typeahead search.
- Mock extractor cannot read non-Latin scripts or free-form prose well; no multi-language handling in mock beyond a few Spanish words.
- No CSRF protection, no auth, no pagination, no file size limits.
- Pipeline runs inside the request, so a slow LLM call blocks the form submit.

## Next 3 things to build

1. Real ingestion: a Gmail/IMAP poller and Twilio webhook creating `InboundMessage`s, with a background worker instead of synchronous processing.
2. A catalog/customer admin UI plus a typeahead SKU picker and a CSV catalog importer (replacing the seed script).
3. A real ERP adapter interface (QuickBooks/Zoho) with idempotent pushes and an eval harness that scores extraction accuracy on labelled messages.
