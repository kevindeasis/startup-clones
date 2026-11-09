# Latent clone: a runtime hallucination catcher

> Independent clone built for learning. **Not affiliated with, endorsed by, or derived from the code of Latent.** All product ideas belong to the original company.

## What the original company does

[Latent](https://runlatent.ai) (YC F26; [launch post](https://www.ycombinator.com/launches/WBw-latent-stop-hallucinations-before-they-reach-your-customers)) sits at runtime between an LLM app and its users. Every finished answer gets a "made-up-ness" score. Answers over a threshold are flagged, and an intervention policy decides what happens: hold and send fallback text, ask a stronger model, or deliver and log for review. Flagged answers land in a review queue that highlights the riskiest sentence and the source sentence it relied on. Reviewer decisions become labeled data that recalibrate the threshold and can be exported for fine-tuning. Integration is a one-line Python SDK or a gateway. Their moat is a cheap reader model over hidden-state activations, claimed to be about 500x cheaper than an LLM judge.

## What this clone does and skips

Does: `POST /v1/score` (judge + hold / escalate / deliver policies), `POST /v1/chat` (base model, then guard), a server-rendered review-queue dashboard (Pending / Reviewed / All, highlighted risky sentence, Confirm wrong / Clear), `POST /v1/calibrate` (F1 threshold sweep, needs 5+ labels), `GET /v1/export.jsonl`, a zero-dependency Python SDK (`capture`, `auto_instrument`, `flush`, `stats`), Prometheus `/metrics`, `/v1/stats`, an optional flag-rate webhook alert, and an optional static bearer key.

Skips: the hidden-state reader model (**replaced by an LLM judge via the Anthropic SDK plus a deterministic heuristic MockJudge for offline mode**), billing, multi-tenant auth, the OpenAI-compatible gateway, streaming cut-off, judge-selective mode, retention/redaction, OpenTelemetry, Slack/PagerDuty, deployment manifests.

## Architecture

One FastAPI process. `run_score` calls the judge, compares the score with the stored threshold, applies the policy (escalate calls the stronger model), persists the row in SQLite (WAL), updates Prometheus metrics and checks the alert rule. The dashboard is Jinja2 plus a little vanilla JS that calls the same `/v1/*` API. The SDK queues records on a daemon thread and POSTs them to `/v1/score`, failing open.

```
 host app --(latentclone.capture / auto_instrument)--> [queue + daemon thread]
                                                            |
 dashboard (Jinja2 + JS) ----------------+                  v
 curl / clients ------------------------>+--> FastAPI /v1/score, /v1/chat
                                                  |
                      +---------------------------+-------------------------+
                      v                           v                         v
                 judge.py                    policies.py               generator.py
        (AnthropicJudge | MockJudge)  (hold | escalate->STRONG_MODEL | deliver)  (BASE_MODEL | mock)
                      \                           |                         /
                       +--------------> SQLite (answers, settings) <-------+
                                  |            |             |
                           calibrate.py   export.jsonl   /metrics, alerts.py
```

## GitHub tools used

| Name | Link | What it covers |
|---|---|---|
| FastAPI | https://github.com/fastapi/fastapi | API routes, validation, dependency for bearer key |
| uvicorn | https://github.com/Kludex/uvicorn | ASGI server (also run in a thread for SDK tests) |
| anthropic-sdk-python | https://github.com/anthropics/anthropic-sdk-python | Judge, base and stronger models; SDK `auto_instrument` patch target |
| pydantic | https://github.com/pydantic/pydantic | Request/response models |
| Jinja2 | https://github.com/pallets/jinja | Dashboard template |
| prometheus client_python | https://github.com/prometheus/client_python | `/metrics` |
| httpx | https://github.com/encode/httpx | Alert webhook and TestClient transport |
| pytest | https://github.com/pytest-dev/pytest | Tests |

No other third-party libraries are used. (`python-dotenv` is not used; env is read from `os.environ`.)

## Setup and run

Mock mode first (no API key needed):

```bash
cd 2026-11-06-latent
python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env
LLM_PROVIDER=mock uvicorn app.main:app --port 8000
```

Open http://localhost:8000/ and click "Preset: made-up" then "Ask". In another terminal:

```bash
python examples/sdk_demo.py
```

Real mode:

```bash
cp .env.example .env      # then edit .env: set ANTHROPIC_API_KEY=sk-ant-...
set -a; . ./.env; set +a  # load env vars (the FALLBACK_TEXT value is quoted so this works)
uvicorn app.main:app --port 8000
```

If `LLM_PROVIDER=mock` or the key is empty, the app uses the mock judge/generator automatically (`GET /healthz` shows `mock_mode`). The real Anthropic code paths could not be exercised here (no key); only their JSON parsing and fallback logic is unit-tested with fake clients.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | Empty means mock mode |
| `LLM_PROVIDER` | `anthropic` | `anthropic` or `mock` |
| `JUDGE_MODEL` | `claude-sonnet-5-5` | Judge |
| `BASE_MODEL` | `claude-haiku-5-5` | Answer generation for `/v1/chat` |
| `STRONG_MODEL` | `claude-sonnet-5-5` | Escalation policy |
| `FLAG_THRESHOLD` | `0.5` | Initial threshold (recalibration overrides it, stored in `settings`) |
| `FALLBACK_TEXT` | "I'm not certain about that..." | Text sent by the `hold` policy |
| `DATABASE_PATH` | `./data/latent.db` | SQLite file |
| `ALERT_WEBHOOK_URL` | empty | Optional alert target |
| `ALERT_FLAG_RATE` | `0.5` | Alert when flag rate over last 20 answers exceeds this (min 5 samples) |
| `LATENT_API_URL` | `http://127.0.0.1:8000` | Used by the SDK |
| `LATENT_API_KEY` | empty | If set, server requires `Authorization: Bearer <key>` on `/v1/*`; SDK sends it |

## Verification that was run (mock mode, no API key)

```
$ pytest -q
......................                                                   [100%]
22 passed in 2.53s

$ uvicorn app.main:app --port 8000   # DATABASE_PATH=/tmp/..., LLM_PROVIDER=mock
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/        -> 200   (body contains "Review queue")
$ curl -s -X POST localhost:8000/v1/score -H 'content-type: application/json' -d '{"prompt":"What was Q3 revenue?","answer":"Q3 revenue was $4.2M, up 38%, according to CFO Dana Whitfield.","sources":["Q3 revenue was $3.1M, up 12% year over year.","The company has 42 employees."],"policy":"hold"}'
{"id":"5497...","score":0.92,"flagged":true,"threshold":0.5,...,"failure_type":"unsupported_number",...,"action":"held","final_answer":"I'm not certain about that. Let me connect you with a teammate who can verify.",...}
$ same request with answer "Q3 revenue was $3.1M, up 12% year over year."
{"score":0.08,"flagged":false,...,"failure_type":"none",...,"action":"passed","final_answer":"Q3 revenue was $3.1M, up 12% year over year."}
$ curl -s -X POST localhost:8000/v1/reviews -H 'content-type: application/json' -d '{"id":"<flagged id>","decision":"confirmed"}'
{"id":"5497...","review_status":"confirmed"}
$ curl -s localhost:8000/v1/stats
{"scored":2,"flagged":1,"flag_rate":0.5,"confirmed":1,"cleared":0,"reviewed":1,"pending":0,"precision":1.0,"threshold":0.5}
$ curl -s localhost:8000/v1/export.jsonl       -> exactly one line, label "hallucinated"
$ python examples/sdk_demo.py
{'captured': 2, 'sent': 2, 'errors': 0, 'flagged': 1}
$ curl -s -X POST localhost:8000/v1/calibrate
{"detail":"Need at least 5 reviewed answers to calibrate; have 1."}
```

`/metrics` showed `latent_answers_scored_total`, `latent_answers_flagged_total{failure_type="unsupported_number"}` and `latent_reviews_total{decision="confirmed"}`. The server was killed afterwards. The tests cover judge heuristics, the three policies, review/stats, calibrate (200 and 400), export, metrics, bearer key, webhook failure, SDK delivery to a thread-run uvicorn, SDK fail-open on a closed port, and `auto_instrument` fail-open.

## Known limitations

- The mock judge is a crude heuristic (numbers, 2-word capitalized names, word overlap); it will miss paraphrased falsehoods and over-flag unusual phrasing.
- Real Anthropic paths (judge, base, strong model, `auto_instrument` against a live API) are not tested against the live API. `auto_instrument` only handles non-streaming `messages.create`.
- Mock `/v1/chat` always returns a grounded answer; the made-up preset uses `answer_override`.
- The dashboard has no login; with `LATENT_API_KEY` set, its JS reads the key from `localStorage["latent_key"]` (set manually).
- Scoring is synchronous and one SQLite connection per call; fine for a demo, not for load.
- Calibration uses a middle-of-plateau tie-break and a fixed 0.05 grid.

## Next 3 things to build

1. A small reader model (or logprob/consistency-based scorer) to cut judge cost, benchmarked against the LLM judge on the exported labels.
2. Streaming cut-off and an OpenAI-compatible gateway so no SDK change is needed.
3. Per-sentence claim extraction with a source-citation view, and Slack/PagerDuty alert integrations.
