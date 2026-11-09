# Build spec — Particularity clone ("Casework")

**Original company:** Particularity (YC F26) — https://particularity.io — "AI investigators for government regulators."
YC launch: https://www.ycombinator.com/launches/Vq1-particularity-ai-investigators-for-government-regulators

## What the product does

Particularity sells AI agents to consumer-protection agencies (state AGs, city consumer-affairs departments, FTC/CFPB-style bodies). The agents browse live websites the way a consumer would, looking for violations such as junk fees added at checkout, subscription traps (must call to cancel), renewal terms hidden until after card entry, fake urgency (countdown timers that reset, stock counts that never change) and ad-vs-contract mismatches. Every step is screenshotted, timestamped and hashed into an evidence database. Incoming consumer complaints get a first-pass investigation and a harm estimate for triage. Findings are mapped to the elements of the relevant law so staff can go straight to a warning letter or enforcement action, with a full audit trail of evidence and staff decisions.

The clone — call it **Casework** — implements the same three-step loop (Uncover → Investigate → Act) as a single-user local web app.

## Core user flows (implement all five)

1. **Investigate a website.** Staff enters a target URL (optionally a checkout URL and an account/cancellation URL for the same business). The app drives a headless browser (Playwright) to capture each page: full-page PNG screenshot, raw HTML, extracted main text, capture timestamp (UTC), SHA-256 of the HTML and of the screenshot. For the landing page it also takes a second capture ~3 seconds later so timer/stock-count text can be compared (fake-urgency check). Captures become **evidence** rows; the set becomes a **case**. The LLM then analyzes the evidence and produces structured **findings**, each mapped to legal elements from the rulebook.
2. **Triage a consumer complaint.** Staff pastes complaint text. The LLM extracts the business name, the violation category, a harm estimate in cents, a priority (P1–P4) and a two-sentence first-pass summary. If a case already exists for a business whose name matches (case-insensitive substring), the complaint is linked to it and the case priority is raised if the complaint's priority is higher.
3. **Review a case.** Case page shows: business, URL(s), status, priority, harm estimate, the evidence timeline (thumbnail, kind, captured_at, hashes), the findings list (category, severity, confidence, quoted text, which evidence it came from, and the legal elements it satisfies as a checklist), linked complaints, and the decision log.
4. **Record a staff decision.** On the case page, staff pick an action — `warning_letter`, `escalate`, `needs_more_evidence`, `dismiss` — with a note. Every decision is appended to an immutable `decisions` log (never updated or deleted) and updates the case status.
5. **Draft a warning letter.** Button on the case page. The LLM drafts a formal warning letter addressed to the business, citing each finding, the evidence IDs/hashes and the legal elements. Draft is stored and shown with a copy button. (Marked as a draft for attorney review.)

## Stack

- **Python 3.11+**, **FastAPI** (API + server-rendered pages with Jinja2 templates), **uvicorn**.
- **Playwright for Python** (`playwright`, chromium) for browsing and screenshots. Chromium is already installed in the build environment; do NOT run `playwright install` there (document it in the README for other machines).
- **trafilatura** for main-text extraction from captured HTML (fallback: Playwright `inner_text` of `body`).
- **anthropic** Python SDK (`claude-sonnet-4-5` default model, configurable via env) with tool-use / JSON structured output for findings, triage and letters.
- **pydantic** v2 models for all structured LLM output; **sqlite3** from the standard library for storage (single file `data/casework.db`); evidence files on disk under `data/evidence/`.
- Frontend: Jinja2 templates + a small amount of vanilla JS + one CSS file. No build step, no Node.
- Tests: **pytest** + FastAPI `TestClient`.

Verified repos to use (do not add others unless truly necessary):

| Library | Repo | Used for |
|---|---|---|
| Playwright (Python) | https://github.com/microsoft/playwright-python | headless capture, screenshots, timer re-check |
| FastAPI | https://github.com/fastapi/fastapi | API + pages |
| uvicorn | https://github.com/Kludex/uvicorn | ASGI server |
| Anthropic Python SDK | https://github.com/anthropics/anthropic-sdk-python | LLM calls |
| trafilatura | https://github.com/adbar/trafilatura | main-text extraction |
| pydantic | https://github.com/pydantic/pydantic | schemas |

## Folder layout

```
2026-11-04-particularity/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  requirements.txt  .env.example  .gitignore
  app/
    main.py            # FastAPI app, routes, startup (creates tables, data dirs)
    db.py              # sqlite helpers, schema, CRUD
    models.py          # pydantic schemas (Finding, TriageResult, Letter...)
    capture.py         # Playwright capture: screenshot, html, text, hashes, timer recheck
    rulebook.py        # loads rulebook.json; helper to look up elements by id
    rulebook.json      # legal elements (see below)
    analyzer.py        # LLM pipeline + mock analyzer
    llm.py             # Anthropic client wrapper, MOCK mode switch
    templates/         # base.html, index.html, case.html, complaints.html
    static/            # style.css, app.js
    demo/              # the built-in "Bright Mattress Co." demo storefront (templates)
  tests/test_app.py
  data/                # created at runtime, gitignored
```

## Data model (SQLite)

- `cases(id INTEGER PK, business TEXT, target_url TEXT, checkout_url TEXT, cancel_url TEXT, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'P3', harm_estimate_cents INTEGER DEFAULT 0, summary TEXT, created_at TEXT)`
- `evidence(id PK, case_id FK, kind TEXT  -- landing|landing_recheck|checkout|cancel, url TEXT, captured_at TEXT, html_path TEXT, html_sha256 TEXT, screenshot_path TEXT, screenshot_sha256 TEXT, text_excerpt TEXT  -- first 4000 chars of extracted text, meta_json TEXT -- e.g. detected timer strings/prices)`
- `findings(id PK, case_id FK, evidence_id FK NULL, category TEXT, severity TEXT -- low|medium|high, confidence REAL 0-1, title TEXT, summary TEXT, quote TEXT, legal_elements_json TEXT -- list of rulebook element ids, created_at TEXT)`
- `complaints(id PK, case_id FK NULL, text TEXT, business TEXT, category TEXT, harm_estimate_cents INTEGER, priority TEXT, summary TEXT, created_at TEXT)`
- `decisions(id PK, case_id FK, action TEXT, note TEXT, actor TEXT DEFAULT 'staff', created_at TEXT)` — append-only
- `letters(id PK, case_id FK, body TEXT, created_at TEXT)`

Finding categories (fixed enum): `hidden_fee`, `cancellation_obstacle`, `undisclosed_renewal`, `fake_urgency`, `misleading_ad`, `other`.

## Rulebook (`app/rulebook.json`)

A small, plainly-labeled list of legal elements the LLM must cite by id. Keep the wording neutral and generic; this is a demo, not legal advice. Minimum entries:

- `ftc5_representation` — A representation, omission or practice was made to consumers (FTC Act §5 deception element 1).
- `ftc5_likely_to_mislead` — It is likely to mislead a consumer acting reasonably (element 2).
- `ftc5_material` — It is material to the consumer's decision (element 3).
- `rosca_disclosure` — Material terms of a negative-option/auto-renewal offer must be clearly and conspicuously disclosed before obtaining billing information (ROSCA).
- `rosca_consent` — Express informed consent must be obtained before charging (ROSCA).
- `rosca_simple_cancel` — A simple mechanism to stop recurring charges must be provided (ROSCA).
- `junkfee_total_price` — Total price including mandatory fees must be shown up front, not added late in checkout (drip-pricing / junk-fee rules, e.g. FTC Rule on Unfair or Deceptive Fees, state analogues).
- `urgency_false_scarcity` — False or fabricated urgency/scarcity claims (timers that reset, static stock counts) are deceptive practices.

Each entry: `{id, law, element, description}`. Findings map to a list of these ids; the case page renders them as a checklist grouped by law.

## Screens / endpoints

Pages (Jinja2):
- `GET /` — dashboard: "New investigation" form (target_url, checkout_url, cancel_url, business optional), case table (business, status, priority, harm, #findings, created), link to complaints page. Shows a banner "MOCK MODE — set ANTHROPIC_API_KEY for real analysis" when mocked.
- `GET /cases/{id}` — case review (flow 3), decision form (flow 4), "Draft warning letter" button (flow 5), letter display.
- `GET /complaints` — complaint triage form + table of triaged complaints with links to cases.
- `GET /demo/`, `GET /demo/checkout`, `GET /demo/account`, `GET /demo/terms` — built-in demo storefront (below).

JSON API (used by the pages' JS and by tests):
- `GET /api/health` → `{ok: true, mock: bool, model: str}`
- `POST /api/cases` body `{target_url, checkout_url?, cancel_url?, business?}` → runs capture + analysis synchronously, returns the full case with evidence and findings. Must reject non-http(s) URLs.
- `GET /api/cases`, `GET /api/cases/{id}`
- `POST /api/cases/{id}/decisions` body `{action, note}` → appends decision, updates status (`warning_letter`→`letter_pending`, `escalate`→`escalated`, `needs_more_evidence`→`open`, `dismiss`→`closed`).
- `POST /api/cases/{id}/letter` → generates and stores letter, returns `{id, body}`.
- `POST /api/complaints` body `{text}` → triage result incl. `case_id` if linked.
- `GET /evidence/{path}` → serves screenshot/html files from `data/evidence/`.

## Demo storefront ("Bright Mattress Co.")

Served by the app itself so the whole flow can be verified offline. It must deliberately exhibit:
- `/demo/` — hero ad "Dream Mattress $499 — no hidden fees", a countdown timer ("Sale ends in 09:59") implemented in JS that **resets to 09:59 every 5 seconds**, and "Only 3 left in stock!" (static). Link to checkout and account.
- `/demo/checkout` — order summary showing $499 plus a mandatory "Required service fee $89" and "Processing fee $14.99" added at checkout, total $602.99; card-entry form; renewal text "Your Sleep+ membership renews at $19.99/month" shown **below** the card fields in small grey text.
- `/demo/account` — "Subscription: Sleep+ $19.99/mo. To cancel, call 1-800-555-0199 Mon–Fri 9–11am." No cancel button.
- `/demo/terms` — terms page including an early-payoff fee clause contradicting the ad ("no early payoff fees" on landing page; terms say "$75 early payoff fee").

## LLM pipeline (`analyzer.py`, `llm.py`)

- `llm.py`: `is_mock()` → true when `ANTHROPIC_API_KEY` is unset/empty or `CASEWORK_MOCK=1`. `complete_json(system, user, schema_model)` calls `messages.create` with a single tool whose `input_schema` is the pydantic model's JSON schema and `tool_choice` forcing it; parse `tool_use` input into the model. Temperature 0. Model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`). Retry once on validation error with the error text appended.
- **Findings prompt** (`analyze_case`): system prompt = investigator role + category definitions + the rulebook (ids + descriptions) + instruction to quote verbatim text from evidence, give confidence 0–1, and ONLY cite rulebook ids. User message = for each evidence item: kind, url, captured_at, meta (timer values at t0 and t0+3s, stock text, detected prices), text excerpt (truncate to ~6k chars each). Output schema: `{business: str, summary: str, harm_estimate_cents: int, priority: 'P1'|'P2'|'P3'|'P4', findings: [Finding]}`.
- **Triage prompt** (`triage_complaint`): extract `business, category, harm_estimate_cents, priority, summary`.
- **Letter prompt** (`draft_letter`): given case + findings + rulebook elements, write a formal notice (~250–400 words) with placeholders `[AGENCY]`, `[DATE]`, ending with "DRAFT — for attorney review".
- **Mock analyzer** (`mock_analyze`, `mock_triage`, `mock_letter`): deterministic regex/heuristics so every flow works offline: hidden_fee if any `fee` line appears on checkout text but not on landing text; cancellation_obstacle if cancel page text matches `call|phone|1-800` and lacks a cancel button phrase; undisclosed_renewal if `renew` text appears on checkout page; fake_urgency if timer meta shows the timer value at t0+3s ≥ value at t0 (reset) or `only \d+ left` present in both captures unchanged; misleading_ad if landing says "no (hidden|early payoff) fees" and terms/checkout mention such a fee. Harm estimate = sum of detected fee amounts × 100 (cents). Mock triage: regex for `$amount`, keywords → category, business = capitalized words before "charged"/first proper-noun run, else "Unknown".

Capture details (`capture.py`): async Playwright, chromium headless, viewport 1280×900, `page.goto(url, wait_until='networkidle', timeout=20000)` with fallback to `'load'`; `page.screenshot(full_page=True)`; `page.content()`; extract text with trafilatura (`extract(html, include_comments=False)`), fallback to `body.inner_text()`. Meta extraction via regex over the text: timer strings `\b\d{1,2}:\d{2}\b`, `only \d+ left`, prices `\$\d[\d,]*(\.\d{2})?`. For the landing page wait 3s and capture again as `landing_recheck`. Hash with hashlib sha256. Save to `data/evidence/case_{id}/{kind}.png|.html`.

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # leave empty to run in mock mode
ANTHROPIC_MODEL=claude-sonnet-4-5
CASEWORK_MOCK=0               # set 1 to force mock mode even with a key
CASEWORK_DATA_DIR=./data
PORT=8000
```
Load `.env` with `python-dotenv` if present (optional dependency), otherwise rely on the process environment.

## Skip

Auth/users, multi-tenant, billing, real complaint-intake integrations, public-data enrichment, scheduled re-crawls, PDF export, deployment configs. Single-process, single-user. No background job queue: `POST /api/cases` runs the capture inline (document that it takes 10–30 s).

## Acceptance checks (the build must pass all of these; run them in mock mode)

1. `pip install -r requirements.txt` succeeds; `uvicorn app.main:app --port 8000` boots; `GET /api/health` returns 200 with `mock: true` when no key is set.
2. `GET /demo/`, `/demo/checkout`, `/demo/account`, `/demo/terms` all return 200.
3. `POST /api/cases` with `{"target_url":"http://127.0.0.1:8000/demo/","checkout_url":"http://127.0.0.1:8000/demo/checkout","cancel_url":"http://127.0.0.1:8000/demo/account"}` returns a case with **≥4 evidence rows** (landing, landing_recheck, checkout, cancel), each with a non-empty `html_sha256`, `screenshot_sha256` and an existing PNG file, and **≥4 findings** whose categories include at least `hidden_fee`, `cancellation_obstacle`, `undisclosed_renewal`, `fake_urgency`, every finding citing ≥1 valid rulebook id and a non-empty quote.
4. `POST /api/complaints` with "Bright Mattress charged me an $89 service fee that wasn't in the ad and told me I have to call to cancel" returns category `hidden_fee` or `cancellation_obstacle`, `harm_estimate_cents ≥ 8900`, and a `case_id` pointing at the case from check 3.
5. `POST /api/cases/{id}/decisions` with `{"action":"warning_letter","note":"ok"}` → case status `letter_pending` and `GET /api/cases/{id}` shows the decision in `decisions`. `POST /api/cases/{id}/letter` returns a body containing the business name and the string "DRAFT".
6. `GET /` and `GET /cases/{id}` render 200 with the findings and the legal-element checklist visible in the HTML.
7. `pytest -q` passes; tests must cover checks 1–5 (start the app in-process; because Playwright needs a real HTTP server for the demo pages, the test fixture starts uvicorn in a background thread on a free port and points the capture at it).
