# Build spec — Latent clone ("hallucination catcher")

Date: 2026-11-06 · Original company: **Latent** (YC F26) · https://runlatent.ai · Launch: https://www.ycombinator.com/launches/WBw-latent-stop-hallucinations-before-they-reach-your-customers

## 1. What the original product does

Latent sits at runtime between an LLM app's input and output. Every finished answer is scored for "made-up-ness"; answers above a threshold are **flagged** and an **intervention policy** decides what happens: *hold and say* (customer gets fallback text), *ask a stronger model* (a stronger model's answer goes out instead), or *deliver and log* (answer goes out, lands in a review queue). Flagged answers wait in a **review queue** that highlights the riskiest sentence and the source sentence the answer relied on most, with a failure type (unsupported number, wrong date, invented name). Reviewers **confirm** or **clear**; each decision becomes a labeled example used to **recalibrate** the threshold and can be **exported** as fine-tuning/preference data. Integration is a one-line Python SDK (`pip install runlatent`, `runlatent.auto_instrument()`, `flush()`, `stats()`; off-thread, fail-open, zero deps) or an OpenAI-compatible gateway. Observability: a Prometheus endpoint and alerts on flag spikes.

The real company's moat is a cheap **reader model over hidden-state activations** (on self-hosted models) or a small reader model (on API models), claimed ~500× cheaper than an LLM judge. **This clone replaces that with an LLM judge** (Claude via the Anthropic SDK) and a deterministic heuristic judge for offline/mock mode. Everything else — policies, queue, calibration, export, SDK, metrics — is the thin product layer we reproduce.

## 2. Core user flows to implement (all required)

1. **Score an answer** — `POST /v1/score` with `{prompt, answer, sources: [str], policy}` → judge scores it, returns `{id, score, flagged, threshold, risky_sentence, source_sentence, failure_type, explanation, action, final_answer, latency_ms}`. Policy is applied server-side:
   - `hold` → `action="held"`, `final_answer` = the configured fallback text (`FALLBACK_TEXT`).
   - `escalate` → `action="escalated"`, the clone re-asks the stronger model (`STRONG_MODEL`) with the same prompt + sources and returns that answer as `final_answer` (in mock mode, a deterministic "grounded" rewrite built only from source sentences).
   - `deliver` → `action="delivered"`, `final_answer` = original answer; record goes to the queue.
   Not flagged → `action="passed"`, `final_answer` = original answer. Every scored answer is persisted.
2. **Guarded chat (end-to-end demo)** — `POST /v1/chat` with `{question, sources, policy}` → the app generates an answer with the base model (`BASE_MODEL`), then runs flow 1 on it, and returns both the raw answer and the guarded result. This is the "interactive demo" from Latent's homepage. The dashboard has a form for it with two preset examples: a **grounded** answer and a **made-up** answer (fabricated number + invented person name) so the flag is visible without an API key.
3. **Review queue** — `GET /` dashboard (server-rendered Jinja2 + a little vanilla JS) listing flagged answers newest first, each showing: prompt, answer with the **riskiest sentence highlighted**, the **source sentence it relied on most**, failure type chip, score, policy/action, and two buttons **Confirm wrong** / **Clear** → `POST /v1/reviews {id, decision: "confirmed"|"cleared"}`. Tabs/filters: Pending, Reviewed, All. A stats strip at the top: scored, flagged, flag rate, confirmed, precision (confirmed / reviewed), current threshold.
4. **Calibrate** — `POST /v1/calibrate` recomputes the threshold from reviewed records: sweep thresholds 0.05…0.95, pick the one maximizing F1 where positive = `confirmed`; store in `settings`; return `{threshold, labeled_count, precision, recall}`. If fewer than 5 labeled records, return 400 with a clear message. Dashboard has a "Recalibrate" button showing the result.
5. **Export labeled data** — `GET /v1/export.jsonl` streams one JSON line per *reviewed* answer: `{prompt, answer, sources, label ("hallucinated"|"grounded"), score, failure_type, risky_sentence}` (fine-tuning / preference data).
6. **Python SDK** (`sdk/latentclone/__init__.py`, zero third-party deps, stdlib `urllib` + `threading` + `queue`):
   - `latentclone.capture(prompt, answer, sources=None, policy="deliver")` enqueues a record; a daemon thread POSTs to `LATENT_API_URL + "/v1/score"` with header `Authorization: Bearer $LATENT_API_KEY` (key optional for the clone).
   - `latentclone.auto_instrument()` monkey-patches `anthropic.resources.messages.Messages.create` (only if `anthropic` is importable) to capture the prompt (last user message text) and the finished text answer after each call. Must be **fail-open**: any exception inside the SDK is counted in `stats()["errors"]` and never raised to the host app.
   - `latentclone.flush(timeout=5.0)` and `latentclone.stats()` → `{"captured": n, "sent": n, "errors": n, "flagged": n}`.
   - `examples/sdk_demo.py`: starts from env, calls `capture()` on the two preset examples, `flush()`, prints `stats()`. Must work against a locally running server in mock mode.
7. **Observability** — `GET /metrics` (prometheus-client) exposing counters `latent_answers_scored_total`, `latent_answers_flagged_total{failure_type}`, `latent_reviews_total{decision}`, histogram `latent_judge_latency_seconds`. `GET /v1/stats` JSON. Optional: if `ALERT_WEBHOOK_URL` is set, POST a JSON alert when the flag rate over the last 20 answers exceeds `ALERT_FLAG_RATE` (default 0.5); fail silently if the webhook is unreachable.

## 3. Stack

- **Python 3.13**, **FastAPI** (https://github.com/fastapi/fastapi) + **uvicorn** (https://github.com/Kludex/uvicorn) for the API and dashboard.
- **Anthropic Python SDK** (https://github.com/anthropics/anthropic-sdk-python) for the judge, base and stronger models.
- **pydantic v2** (https://github.com/pydantic/pydantic) request/response models.
- **Jinja2** (https://github.com/pallets/jinja) templates; vanilla JS, no frontend build step. Single CSS file, light/dark via `prefers-color-scheme`.
- **SQLite** via stdlib `sqlite3` (WAL mode), file path from `DATABASE_PATH` (default `./data/latent.db`). No ORM.
- **prometheus-client** (https://github.com/prometheus/client_python) for `/metrics`.
- **httpx** (https://github.com/encode/httpx) only for tests (`fastapi.testclient`) and the alert webhook.
- **pytest** (https://github.com/pytest-dev/pytest) for tests.
- Do not add other third-party libraries without a reason noted in the README.

## 4. Repository layout

```
2026-11-06-latent/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  requirements.txt  .env.example  .gitignore  Makefile (optional)
  app/
    main.py          # FastAPI app, routes, startup (init db)
    config.py        # env settings (pydantic BaseSettings or plain os.environ)
    db.py            # sqlite3 connection, schema, CRUD helpers
    judge.py         # Judge protocol; AnthropicJudge + MockJudge; sentence splitting
    policies.py      # apply_policy(record, policy) incl. escalate via stronger model
    generator.py     # base-model answer generation (Anthropic) + mock generator
    calibrate.py     # threshold sweep (F1)
    metrics.py       # prometheus counters/histograms
    alerts.py        # flag-rate webhook alert
    schemas.py       # pydantic models
    templates/index.html
    static/app.css  static/app.js
  sdk/latentclone/__init__.py   # zero-dep SDK (capture, auto_instrument, flush, stats)
  examples/sdk_demo.py
  tests/test_api.py  tests/test_judge.py  tests/test_calibrate.py  tests/test_sdk.py
```

## 5. Data model (SQLite)

```sql
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,              -- uuid4 hex
  created_at TEXT NOT NULL,         -- ISO 8601 UTC
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources_json TEXT NOT NULL,       -- JSON array of strings
  score REAL NOT NULL,              -- 0..1 probability the answer is made up
  threshold REAL NOT NULL,          -- threshold at scoring time
  flagged INTEGER NOT NULL,         -- 0/1
  risky_sentence TEXT,
  source_sentence TEXT,
  failure_type TEXT,                -- unsupported_number | wrong_date | invented_name | unsupported_claim | none
  explanation TEXT,
  policy TEXT NOT NULL,             -- hold | escalate | deliver
  action TEXT NOT NULL,             -- passed | held | escalated | delivered
  final_answer TEXT NOT NULL,
  judge_model TEXT NOT NULL,        -- e.g. claude-sonnet-5-5 or "mock"
  latency_ms INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | cleared
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_answers_created ON answers(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- settings: threshold (default from env, 0.5)
```

## 6. LLM pipeline design

**Judge (`app/judge.py`)** — interface `Judge.score(prompt, answer, sources) -> JudgeResult(score, risky_sentence, source_sentence, failure_type, explanation)`.

- `AnthropicJudge`: one `messages.create` call to `JUDGE_MODEL` with `max_tokens=600`, temperature 0. System prompt: "You are a strict fact-checker. Judge ONLY against the provided sources." User content: the sources (numbered), the user prompt, the answer split into numbered sentences. Ask for **JSON only** with keys: `sentences: [{index, supported: bool, reason}]`, `hallucination_probability: float 0..1`, `riskiest_sentence_index: int`, `most_relied_source_index: int`, `failure_type: one of the five`. Parse with a tolerant extractor (find first `{`…last `}`); on parse failure fall back to the MockJudge result and set `explanation="judge output unparseable; heuristic fallback"`. Map indices back to sentence strings.
- `MockJudge` (used when `LLM_PROVIDER=mock` **or** `ANTHROPIC_API_KEY` is missing): deterministic heuristics on the answer vs. the joined sources: any number/percent/currency token in the answer not present in sources → `unsupported_number` (a 4-digit 19xx/20xx token → `wrong_date`); any capitalized two-word name (`[A-Z][a-z]+ [A-Z][a-z]+`) not in sources and not at sentence start → `invented_name`; otherwise, if a sentence shares <2 content words with any source → `unsupported_claim`; else `none`. Score = 0.92 if any failure else 0.08; risky sentence = first offending sentence; source sentence = source sentence with highest word overlap to the risky sentence.
- Sentence splitting: regex on `(?<=[.!?])\s+`; keep it in one helper used by both judges and the dashboard highlighter.

**Base model (`app/generator.py`)** — `BASE_MODEL` answers the question using the sources ("answer using only the sources; if unknown, say so"). Mock generator returns the preset answers (grounded for questions containing "revenue"... keep it simple: returns the first two source sentences joined).

**Stronger model (`app/policies.py`)** — on `escalate`, call `STRONG_MODEL` with the same instruction and sources; mock returns a rewrite built only from source sentences with the highest overlap to the prompt.

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # leave empty to run in mock mode
LLM_PROVIDER=anthropic        # anthropic | mock (auto-falls back to mock if no key)
JUDGE_MODEL=claude-sonnet-5-5
BASE_MODEL=claude-haiku-5-5
STRONG_MODEL=claude-sonnet-5-5
FLAG_THRESHOLD=0.5
FALLBACK_TEXT=I'm not certain about that. Let me connect you with a teammate who can verify.
DATABASE_PATH=./data/latent.db
ALERT_WEBHOOK_URL=
ALERT_FLAG_RATE=0.5
LATENT_API_URL=http://127.0.0.1:8000   # used by the SDK
LATENT_API_KEY=                        # optional; if set, the server requires it as Bearer on /v1/*
```

Model names are defaults only; read them from env so they can be changed without code edits. Use `python-dotenv` only if already a transitive dependency; otherwise read `os.environ` and document `export $(cat .env | xargs)` / `set -a; . ./.env` in the README.

## 8. What to skip

Auth beyond the optional static bearer key, billing, multi-tenant orgs, hidden-state/vLLM reader model, OpenTelemetry, Slack/PagerDuty integrations (webhook only), streaming cut-off, the OpenAI-compatible gateway, judge-selective mode, retention/redaction settings, deployment manifests.

## 9. Acceptance checks (the build must pass all of these, in mock mode, without any API key)

1. `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt` succeeds.
2. `pytest -q` passes with at least 10 tests covering: mock judge flags fabricated number / invented name / wrong date; grounded answer passes; each of the three policies produces the right `action` and `final_answer`; review changes status and stats; calibrate returns a threshold and 400 when under-labeled; export emits only reviewed rows as valid JSONL; `/metrics` contains `latent_answers_scored_total`; SDK `capture()`+`flush()` reaches the server (use a thread-run uvicorn or TestClient-backed URL) and `stats()["sent"] >= 1`; SDK stays fail-open when `LATENT_API_URL` points at a closed port (no exception, `errors >= 1`).
3. `uvicorn app.main:app --port 8000` boots; `curl -s localhost:8000/` returns 200 HTML containing "Review queue".
4. `curl -s -X POST localhost:8000/v1/score -H 'content-type: application/json' -d '{"prompt":"What was Q3 revenue?","answer":"Q3 revenue was $4.2M, up 38%, according to CFO Dana Whitfield.","sources":["Q3 revenue was $3.1M, up 12% year over year.","The company has 42 employees."],"policy":"hold"}'` → `flagged: true`, `action: "held"`, `final_answer` equals FALLBACK_TEXT, `failure_type` is `unsupported_number` or `invented_name`.
5. Same request with `"answer":"Q3 revenue was $3.1M, up 12% year over year."` → `flagged: false`, `action: "passed"`.
6. `POST /v1/reviews` on the flagged id with `confirmed` → `GET /v1/stats` shows `confirmed: 1`.
7. `GET /v1/export.jsonl` returns one line for the confirmed record.
8. `python examples/sdk_demo.py` against the running server prints stats with `sent >= 2`.
9. README documents all of the above commands verbatim and the mock vs. real mode.
