# Casework — a clone of Particularity

**Original company:** [Particularity](https://particularity.io) (YC F26) sells AI investigators to government
consumer-protection regulators. Its agents browse live websites like a consumer, hunting junk fees, subscription traps,
hidden renewal terms, fake urgency and ad-vs-contract mismatches. Every step is screenshotted, timestamped and hashed
into an evidence database; incoming complaints get a first-pass investigation and harm estimate for triage; findings are
mapped to legal elements so staff can go to a warning letter or enforcement with a full audit trail.
YC launch page: https://www.ycombinator.com/launches/Vq1-particularity-ai-investigators-for-government-regulators

**Casework** is a single-user local web app implementing the same Uncover -> Investigate -> Act loop.

## What it does
1. **Investigate a website** - Playwright captures landing, the landing page held open ~7 s while timer/stock text is sampled about once per second (`meta.timer_samples`), then a fresh-reload `landing_recheck`,
   checkout, cancel/account and (if linked from the landing page) terms pages: full-page PNG, raw HTML, extracted text,
   UTC timestamp, SHA-256 of HTML and PNG. An LLM (or the offline mock analyzer) produces findings mapped to rulebook legal elements.
2. **Triage a complaint** - extracts business, category, harm (cents), priority P1-P4 and a 2-sentence summary; links to an
   existing case by case-insensitive business-name substring and raises that case's priority if needed.
3. **Review a case** - evidence timeline, findings with legal-element checklists grouped by law, linked complaints, decision log.
4. **Record a decision** - `warning_letter | escalate | needs_more_evidence | dismiss`; stored in an append-only table
   (SQLite triggers block UPDATE/DELETE) and updates the case status.
5. **Draft a warning letter** - stored, shown with a Copy button, marked "DRAFT — for attorney review".

A built-in demo storefront ("Bright Mattress Co.") at `/demo/` deliberately exhibits a reset countdown, a static stock
count, late fees, fine-print renewal, call-to-cancel and an early-payoff-fee contradiction, so everything works offline.

**Skipped:** auth/users, multi-tenant, billing, real complaint-intake integrations, public-data enrichment, scheduled
re-crawls, PDF export, deployment configs, background job queue (`POST /api/cases` runs inline, ~7–30 s).

## Architecture
FastAPI app (`app/main.py`) serving Jinja2 pages and a JSON API. `capture.py`: async Playwright + trafilatura + hashing.
`analyzer.py`: LLM prompts and deterministic mock analyzers. `llm.py`: Anthropic tool-use wrapper (single forced tool whose
schema is the pydantic model, temperature 0, one retry on validation error) and the mock switch. `db.py`: stdlib sqlite3
(`data/casework.db`). `rulebook.json`: 8 generic legal elements; findings may cite only these ids (invalid ids are stripped,
and confidence is capped when a quote is not verbatim in the evidence). Evidence files live in `data/evidence/case_{id}/`.
Frontend: Jinja2 + vanilla JS + one CSS file; no build step.

## GitHub tools used
- Playwright for Python — https://github.com/microsoft/playwright-python (capture, screenshots, timer re-check)
- FastAPI — https://github.com/fastapi/fastapi (API + pages)
- uvicorn — https://github.com/Kludex/uvicorn (ASGI server)
- Anthropic Python SDK — https://github.com/anthropics/anthropic-sdk-python (LLM calls)
- trafilatura — https://github.com/adbar/trafilatura (main-text extraction)
- pydantic — https://github.com/pydantic/pydantic (schemas)

## Setup and run
```bash
cd 2026-11-04-particularity
python3 -m venv .venv && source .venv/bin/activate     # optional
pip install -r requirements.txt
playwright install chromium        # only on machines without a Playwright Chromium
cp .env.example .env               # optional; leave ANTHROPIC_API_KEY empty for mock mode
uvicorn app.main:app --port 8000   # or: python -m app.main
```
Open http://127.0.0.1:8000/, click "Fill demo storefront", then "Investigate".
Tests: `pytest -q` (temp data dir, forced mock mode, background uvicorn thread serving the demo pages).

## Environment variables
| Var | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | If set (and `CASEWORK_MOCK` is not 1), real Claude analysis is used. Empty -> mock mode. |
| `ANTHROPIC_MODEL` | default `claude-sonnet-4-5` |
| `CASEWORK_MOCK` | `1` forces mock mode |
| `CASEWORK_DATA_DIR` | default `./data` |
| `PORT` | used by `python -m app.main` |

## Known limitations
- The real-LLM path (`llm.complete_json` and the prompts) is implemented but **not exercised** here (no API key); only mock mode was run.
- The mock analyzer is regex-based and tuned to the demo storefront. Fake-urgency signals: (1) strongest: on the same open page the
  first timer value increases between consecutive samples (a visible reset); (2) after reload, the timer is not lower than the first
  reading minus 1 s (weak: an honest countdown that restarts on reload also trips it); (3) a stock claim identical in both captures (weak, medium severity).
- Extracted text is stored capped at 4000 chars, so the LLM sees at most that per evidence item.
- Capture blocks the request and there is no auth: do not expose it publicly (it fetches any http(s) URL, including internal ones).
- No login flows or multi-step carts; hashes show file integrity but are not a trusted timestamp.
- The rulebook is a generic demo list, not a statement of current law.

## Next 3 things to build
1. LLM-driven multi-step browsing (add to cart, checkout, cancellation flows) plus DOM-level dark-pattern checks.
2. Background job queue with progress streaming, scheduled re-crawls and capture diffing over time.
3. Evidence export (signed PDF/ZIP bundle with RFC 3161 timestamps) and complaint-intake connectors.

## Not legal advice
Casework is a demonstration. Findings, rulebook entries and letters are automated drafts, not legal advice or legal
conclusions; all output requires review by a qualified attorney before any use.
