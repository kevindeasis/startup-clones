# Build spec — Asakana clone ("OrderDesk")

Date: 2026-10-25
Original company: Asakana (YC F26) — https://www.asakana.co/ — https://www.ycombinator.com/companies/asakana

## 1. What the product does

Asakana is an AI order desk for food distributors (live at US seafood distributors). Restaurants send orders by email, text message, WhatsApp, voicemail, or a photo of a handwritten note. Someone at the distributor retypes every order into the ERP. Asakana reads the messy inbound message, resolves shorthand ("2 cs hamachi", "same as last Friday"), matches each line to the distributor's product catalog, and creates a draft order in the ERP. Anything unclear is routed to a human reviewer first. Reps get one summary per task saying what was entered and what to watch.

**The clone ("OrderDesk")** implements that core loop end-to-end as a local web app:

inbound message (pasted text, .eml, PDF, or photo) → LLM extraction into a structured order → fuzzy catalog + customer-alias matching → confidence-based routing (auto vs. human review) → review UI → "push to ERP" (a mock ERP table + CSV/JSON export) → one-line rep summary → learning loop (reviewer corrections become customer-specific aliases).

## 2. Core user flows (implement all five)

1. **Intake.** On `/intake` the user pastes a message (email body or SMS), optionally picks the customer (or leaves it blank and lets the pipeline infer it from the sender/signature), picks a channel (email / sms / photo / pdf), and optionally uploads a file (`.png/.jpg` photo of a handwritten note, `.pdf`, or `.eml`). Submitting creates an `InboundMessage` and runs the pipeline synchronously, then redirects to the draft order page.
2. **Extraction + matching pipeline.** (a) Build the LLM context: customer profile (name, known shorthand/aliases, last 3 orders as compact lines), the catalog slice (all SKUs with name, unit, pack size — the seeded catalog is ~40 items so send it whole), today's date. (b) Call the LLM with a tool/JSON schema to return `ExtractedOrder` (see data model). Images go to the LLM as vision input; PDFs are text-extracted with pypdf first; `.eml` is parsed with the stdlib `email` module (use the plain-text part, fall back to stripped HTML). (c) For each extracted line, match to a SKU: exact customer alias hit → confidence 1.0; else rapidfuzz `process.extractOne` over SKU names + global aliases using `fuzz.WRatio` (score/100) with a pack/unit sanity check; keep the top 3 candidates. (d) Resolve references to past orders ("same as last Friday / usual order / repeat last") by copying lines from the customer's most recent matching order and flagging them `source="history"`. (e) Routing: a draft is `auto_approved` only if every line has confidence ≥ 0.90, customer is known, and the LLM returned no `questions`; otherwise `needs_review`. Auto-approved drafts are still shown in the queue, but with a green badge, and still require a click to push (keeps the demo safe).
3. **Review queue + order detail.** `/` lists draft orders newest first with status badge, customer, channel, line count, and the number of flagged lines. `/orders/{id}` shows the original message (and the uploaded image/PDF text) on the left, and on the right an editable table of lines: raw text as written → matched SKU (select with the top-3 candidates + full catalog search), qty, unit, confidence bar, flag reason. Line edits save via HTMX `POST /orders/{id}/lines/{line_id}`. Buttons: **Approve & push to ERP**, **Reject**. Any LLM `questions` are shown as a yellow callout.
4. **Push to ERP.** Approving writes an `ErpOrder` + `ErpOrderLine` rows (the mock ERP), marks the draft `pushed`, and generates a `RepSummary` — a short plain-text note in the style "Entered order #1042 for Blue Fin Bistro: 2 cs Hamachi loin, 10 lb Salmon fillet. Watch: 'kampachi' matched to Kampachi fillet at 78%." The summary is shown on the order page and listed at `/summaries`. `/erp/orders` (JSON) and `/erp/orders.csv` (CSV download) expose what an ERP integration would receive.
5. **Learning loop.** When a reviewer changes a line's SKU, store `CustomerAlias(customer_id, raw_text_normalized, sku)` (upsert). The matcher checks customer aliases first, so the same shorthand from the same customer matches at 1.0 next time. `/customers/{id}` lists the customer's aliases, order history, and lets the user delete an alias.

## 3. Stack

Python 3.11+ · FastAPI · SQLModel (SQLite file `orderdesk.db`) · Jinja2 templates · HTMX (vendored single JS file in `app/static/htmx.min.js` — download it during setup or ship it; if network is unavailable, inline a note and degrade to full-page forms) · Anthropic Python SDK · RapidFuzz · pypdf · Pillow · python-multipart · uvicorn · pytest + httpx for tests.

No frontend build step. Plain CSS in `app/static/style.css`. Keep it clean and readable; no CSS framework required.

### Open-source libraries and what each covers (all verified on PyPI 2026-10-25)

| Library | Repo | Used for |
|---|---|---|
| FastAPI | https://github.com/fastapi/fastapi | HTTP app, routing, form + file upload handling |
| SQLModel | https://github.com/fastapi/sqlmodel | ORM + SQLite data model |
| HTMX | https://github.com/bigskysoftware/htmx | Inline line edits and partial updates without a JS build |
| Jinja2 | https://github.com/pallets/jinja | Server-rendered templates |
| Anthropic Python SDK | https://github.com/anthropics/anthropic-sdk-python | LLM extraction (text + vision) with tool-use forced JSON output |
| RapidFuzz | https://github.com/rapidfuzz/RapidFuzz | Fuzzy catalog matching (`process.extractOne`, `fuzz.WRatio`) |
| pypdf | https://github.com/py-pdf/pypdf | Text extraction from PDF order sheets |
| Pillow | https://github.com/python-pillow/Pillow | Validate/resize uploaded photos before sending to the model; generate the sample handwritten-note PNG in the seed script |
| uvicorn | https://github.com/Kludex/uvicorn | ASGI server |
| pytest + httpx | https://github.com/pytest-dev/pytest, https://github.com/encode/httpx | Tests via FastAPI TestClient |

## 4. Data model (SQLModel tables)

- `Customer(id, name, contact_emails: str (comma-sep), contact_phones: str, notes: str, created_at)`
- `Product(id, sku: str unique, name: str, unit: str e.g. "lb"/"cs"/"ea", pack_size: str e.g. "10 lb case", category: str, aliases: str comma-sep global aliases, active: bool)`
- `CustomerAlias(id, customer_id FK, raw_text_normalized: str, sku: str, created_at)` unique on (customer_id, raw_text_normalized)
- `InboundMessage(id, channel: "email"|"sms"|"photo"|"pdf", sender: str, subject: str, body_text: str, attachment_path: str|None, attachment_kind: str|None, received_at)`
- `DraftOrder(id, message_id FK, customer_id FK|None, inferred_customer_name: str|None, delivery_date: date|None, status: "needs_review"|"auto_approved"|"pushed"|"rejected", llm_notes: str, llm_questions: str (JSON list), llm_provider: str, llm_model: str, created_at, pushed_at)`
- `DraftLine(id, draft_id FK, raw_text: str, qty: float|None, unit: str|None, product_text: str, sku: str|None, product_id FK|None, confidence: float, candidates: str (JSON list of {sku,name,score}), source: "message"|"history", flag: str|None, note: str|None)`
- `ErpOrder(id, erp_number: str e.g. "SO-1042", customer_id FK, delivery_date, created_at, draft_id FK)` and `ErpOrderLine(id, erp_order_id FK, sku, qty, unit, description)`
- `RepSummary(id, draft_id FK, text: str, created_at)`

### LLM output schema (`ExtractedOrder`, Pydantic)

```
customer_name_hint: str | None
delivery_date_hint: str | None        # free text as written, e.g. "Friday", "tmrw"
delivery_date: str | None             # ISO date resolved by the model given today's date
repeat_reference: str | None          # e.g. "same as last Friday" if the message references a past order
lines: list[{ raw_text: str, qty: float | None, unit: str | None, product_text: str, note: str | None }]
questions: list[str]                  # things a human must confirm
language: str                         # detected language code
```

## 5. Screens / endpoints

| Route | Purpose |
|---|---|
| `GET /` | Review queue (all drafts, filter by status) |
| `GET /intake`, `POST /intake` | Intake form; POST runs pipeline, redirects to `/orders/{id}` |
| `GET /orders/{id}` | Order detail / review page |
| `POST /orders/{id}/lines/{line_id}` | HTMX partial: update sku/qty/unit; records alias if sku changed |
| `POST /orders/{id}/approve` | Push to mock ERP, create RepSummary |
| `POST /orders/{id}/reject` | Mark rejected |
| `GET /customers`, `GET /customers/{id}`, `POST /customers/{id}/aliases/{alias_id}/delete` | Customer context + learned aliases |
| `GET /catalog` | Product catalog table |
| `GET /summaries` | Rep summaries list |
| `GET /erp/orders` (JSON), `GET /erp/orders.csv` | Mock ERP export |
| `GET /api/orders/{id}` | JSON of a draft (for tests/integration) |
| `GET /health` | `{"ok": true, "llm_provider": "anthropic"|"mock"}` |

## 6. LLM pipeline design

- Module `app/llm.py` exposes `extract_order(message: InboundMessage, context: PipelineContext) -> ExtractedOrder` with two providers chosen by `LLM_PROVIDER` env (`anthropic` default when `ANTHROPIC_API_KEY` is set, otherwise `mock`).
- **Anthropic provider:** one `messages.create` call, model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`), `max_tokens=2048`, `tools=[{name:"submit_order", input_schema: ExtractedOrder JSON schema}]`, `tool_choice={"type":"tool","name":"submit_order"}`. System prompt: role (order-desk assistant for a seafood distributor), rules (never invent items; keep `raw_text` verbatim; qty/unit as written; put anything uncertain in `questions`; resolve relative dates from today's date; handle Spanish/Japanese/Chinese/Korean shorthand), followed by the customer profile, the last 3 orders, and the catalog as a compact `SKU | name | unit | pack` list. User content: the message text; for photos append an `image` content block (base64, resized to ≤1568px longest side via Pillow). Parse the tool input with Pydantic; on validation failure retry once with the error appended.
- **Mock provider (`app/llm_mock.py`):** deterministic, no network. Split the text into lines/commas; regex `^(\d+(?:\.\d+)?)\s*(cs|case|cases|lb|lbs|pc|pcs|ea|box|boxes|kg)?\s*(?:of\s+)?(.+)$` (also handle trailing qty like "hamachi x2" and Spanish "2 cajas de"). Detect "same as last friday|usual|repeat" → `repeat_reference`. Detect a weekday/"tomorrow"/"tmrw" → `delivery_date_hint` and resolve to ISO. If the message is an image with no text, return a fixed sample extraction with `questions=["Mock mode: image reading requires ANTHROPIC_API_KEY"]`. Must be good enough that the seeded sample messages produce sensible drafts.
- Matching lives in `app/matching.py` (pure functions, unit-tested): `normalize(text)`, `match_line(product_text, customer_aliases, products) -> (sku, confidence, candidates)`.
- Routing + ERP push + summary live in `app/pipeline.py` and `app/erp.py`.

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # optional; if empty the app runs with LLM_PROVIDER=mock
ANTHROPIC_MODEL=claude-sonnet-4-5
LLM_PROVIDER=                 # "anthropic" | "mock" | empty = auto
DATABASE_URL=sqlite:///./orderdesk.db
AUTO_APPROVE_THRESHOLD=0.90
UPLOAD_DIR=./uploads
```

Load with `os.environ` (optionally python-dotenv). Never commit `.env` or `orderdesk.db` or `uploads/`.

## 8. Seed data (`python -m app.seed`)

- Catalog: ~40 seafood SKUs (hamachi loin, kampachi fillet, salmon fillet Atlantic 10 lb, salmon portions 6 oz, ahi tuna saku, bluefin otoro, uni tray, hotate (scallops) U10, ebi 16/20, shrimp 21/25 P&D, oysters Kumamoto dz, oysters Kusshi dz, mussels PEI 10 lb, clams manila, halibut fillet, black cod (sablefish), branzino whole, snapper whole, lobster tail 8 oz, king crab legs, Dungeness crab, octopus tako, squid ika, eel unagi, mackerel saba, ikura, tobiko, crab meat jumbo lump, smoked salmon, cod loins, etc.) with units and global aliases (e.g. "yellowtail"→hamachi, "sablefish"→black cod, "tako"→octopus, "camarón/camaron"→shrimp, "salmón"→salmon).
- 3 customers: "Blue Fin Bistro" (English, texts shorthand, aliases: "hama"→HAMACHI-LOIN, "the usual salmon"→SALMON-FIL-ATL), "Mariscos El Puerto" (Spanish emails), "Sakura Omakase" (Japanese romaji shorthand, orders uni and otoro). Each with 2–3 past ErpOrders so "same as last Friday" has something to resolve to.
- 5 sample inbound messages saved as files in `samples/`: `sms_bluefin.txt` ("hey can i get 2 cs hama, 10lb salmon fillet and same as last friday for the oysters. friday delivery"), `email_elpuerto.eml` (Spanish, with a small table), `email_table.txt` (an email with a quantity/product table + a typo'd SKU), `pdf_order_sheet.pdf` (generate with a tiny script using reportlab if available, otherwise a plain text file named `.pdf` is NOT acceptable — if reportlab isn't installable, skip the PDF sample and note it), and `photo_note.png` (generated by the seed script with Pillow: white background, hand-written-style text "3 cs hotate U10 / 2 lb ikura / 1 whole branzino — Sakura, Thurs"). A "Load sample" dropdown on `/intake` fills the form from these.

## 9. What to skip

Auth, billing, multi-tenant, real email/SMS/WhatsApp ingestion (Gmail, Twilio), real ERP connectors (QuickBooks, Sage, Zoho), voicemail/speech, background jobs/queues, credit memos/returns/collections/upsell workflows, admin UI. Document each in README "What it skips".

## 10. Acceptance checks (the build must pass all of these, run in mock mode with no API key)

1. `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` succeeds.
2. `python -m app.seed` creates `orderdesk.db` with ≥35 products, 3 customers, ≥6 historical ERP orders, and the sample files in `samples/`.
3. `pytest -q` passes with ≥8 tests covering: mock extraction schema; `match_line` exact alias → 1.0; fuzzy match "salmon filet" → SALMON-FIL-ATL ≥0.8; Spanish alias "camaron" → a shrimp SKU; routing (`needs_review` when any line < threshold); `POST /intake` with `sms_bluefin.txt` creates a draft with ≥3 lines including a `source="history"` line; approving creates an `ErpOrder` and the CSV export contains the ERP number; changing a line's SKU creates a `CustomerAlias` and a second identical intake matches that line at 1.0; `/health` returns 200.
4. `uvicorn app.main:app --port 8000` boots; `curl localhost:8000/` returns 200 and the queue HTML; `/intake`, `/catalog`, `/customers`, `/summaries`, `/erp/orders`, `/erp/orders.csv` all return 200.
5. The Anthropic provider path is exercised at least by a unit test that mocks `anthropic.Anthropic().messages.create` to return a tool_use block and asserts the parsed `ExtractedOrder` (so the code path is known to run without a real key).
6. `.env.example`, `.gitignore`, `README.md`, `requirements.txt` present; no secrets or `.db`/`uploads/` committed.
