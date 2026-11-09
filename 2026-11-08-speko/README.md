# Speko-lite — "OpenRouter for Voice AI" (learning clone)

> **Independent learning clone. Not affiliated with, endorsed by, or derived from code of Speko (YC S26).**

## What the original company does
[Speko](https://www.ycombinator.com/companies/speko) routes voice-agent traffic through one API/key to the speech-to-text (STT), LLM and text-to-speech (TTS) models that benchmarks show are best for a given language and use case, with failover when a provider breaks. It publishes benchmarks at benchmarks.speko.ai and launched on HN as "Launch HN: Speko (YC S26) – OpenRouter for Voice AI".

## What this clone does
A voice-model gateway with one HTTP API:
- **Benchmark harness** – runs a built-in eval set (6 sentences x 5 languages: en, es, de, hi, ja) through every provider; STT gets real WER via `jiwer`, plus latency and cost; LLM gets a rubric score; TTS gets a (mock) naturalness score. Rows persist in SQLite and drive the leaderboard.
- **Router** – `POST /api/route` ranks providers by weighted, normalized quality/latency/cost. Weights depend on `priority` and `use_case` (`support_call` favors quality, `realtime_voice` favors latency, `ivr` favors cost). Cost is normalized on a log scale because prices span orders of magnitude. Providers with no benchmark data for the language rank last.
- **Voice turn pipeline** – `POST /api/turn` (text or audio) runs STT -> LLM -> TTS, returns transcript, reply, base64 WAV and a per-stage `trace` (provider, latency, cost, attempts).
- **Failover + circuit breaker** – on error, retries down the ranked list (max 3 providers per stage). 3 consecutive failures open a 60 s breaker that excludes the provider. `POST /api/admin/fault` injects `fail` / `slow` / `ok`.
- **Dashboard** – single static page at `/` with Leaderboard, Router playground, Voice turn and Health tabs.

**Skipped (per spec):** auth, billing, API-key management, real telephony/WebRTC streaming, real benchmark audio corpora, multi-tenancy.

## Architecture
```
static/index.html        vanilla HTML/JS dashboard (no build step)
app/main.py              FastAPI app, endpoints, startup seeding
app/providers.py         registry; deterministic mock STT/LLM/TTS; real litellm adapters (lazy import)
app/benchmarks.py        eval harness (jiwer WER), persistence, latest-per-provider leaderboard
app/routing.py           weighted scoring and ranking
app/gateway.py           per-stage execution with failover
app/health.py            provider_health table, fault injection, circuit breaker
app/db.py, config.py, data.py   SQLite schema, env config, eval sets/validation
tests/test_api.py        pytest + TestClient acceptance checks A1-A7
scripts/smoke.sh         boots uvicorn and curls the endpoints
```
SQLite tables: `benchmark_results`, `provider_health`, `turns`. Stored `metric_quality` is a 0-1 "higher is better" score (STT: `1 - WER`); the API also exposes `wer` for STT rows.

Mock providers have seeded per-language error rate / latency / price: `mock-stt-alpha` is best on en/es/de, `mock-stt-beta` best on hi/ja, `mock-stt-gamma` is the cheapest. Mock STT corrupts the reference words with probability = its error rate (seeded RNG), so `jiwer` produces real, deterministic WERs. The mock "audio" is a playable beep WAV with an embedded `spko` chunk naming the eval sentence (`GET /api/eval-audio` produces one). Uploading arbitrary real audio in mock mode yields a placeholder transcript. In a text turn, the text is passed through the chosen mock STT and may be slightly corrupted by design. Mock "slow" faults add 800 ms to the reported latency (no real sleeping).

## GitHub / open-source tools used
- [`fastapi`](https://github.com/fastapi/fastapi) + [`uvicorn`](https://github.com/encode/uvicorn) – API server
- [`pydantic`](https://github.com/pydantic/pydantic) v2 – request validation
- [`jiwer`](https://github.com/jitsi/jiwer) – word error rate
- [`litellm`](https://github.com/BerriAI/litellm) – unified `completion` / `transcription` / `speech` for real providers (imported lazily)
- [`httpx`](https://github.com/encode/httpx), `python-multipart`, [`pytest`](https://github.com/pytest-dev/pytest)

## Setup and run
Requires Python 3.11+.
```bash
cd 2026-11-08-speko
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # optional; keys empty = mock mode
.venv/bin/python -m uvicorn app.main:app --port 8000   # or: .venv/bin/python -m app.main
# open http://localhost:8000
```
Tests and smoke test:
```bash
.venv/bin/python -m pytest -q
bash scripts/smoke.sh          # boots uvicorn on :8765 (SMOKE_PORT), curls endpoints, kills it
```
The app does not auto-load `.env`; export the variables (`set -a; source .env; set +a`) or pass them inline.

Example:
```bash
curl -s localhost:8000/api/route -H 'content-type: application/json' \
  -d '{"stage":"stt","language":"hi","use_case":"support_call","priority":"quality"}'
curl -s localhost:8000/api/turn -F text="please book a table" -F language=en -F priority=quality
curl -s localhost:8000/api/admin/fault -H 'content-type: application/json' -d '{"provider":"mock-stt-alpha","mode":"fail"}'
```

## Endpoints
`GET /` dashboard, `GET /api/health`, `GET /api/providers`, `POST /api/benchmarks/run`, `GET /api/benchmarks?stage=&language=`, `POST /api/route`, `POST /api/turn`, `GET /api/turns`, `POST /api/admin/fault`. Extras: `POST /api/admin/reset` (clear all faults/breakers), `GET /api/eval-audio`. Unknown language/stage/use_case/priority return 422 with a message listing supported values.

## Environment variables
| Var | Default | Meaning |
|---|---|---|
| `MOCK_MODE` | `1` when no keys are present | `1` = mock providers only; `0` also registers real adapters whose key exists |
| `ANTHROPIC_API_KEY` | – | enables `anthropic/claude-haiku-5-5`, `anthropic/claude-sonnet-5-5` |
| `OPENAI_API_KEY` | – | enables `openai/whisper-1`, `openai/tts-1` |
| `DATABASE_URL` | `./speko.db` | SQLite path |
| `PORT` | `8000` | port used by `python -m app.main` |

## Known limitations
- **Real provider adapters are implemented and import/construct cleanly (checked with dummy keys) but are untested against live APIs** — no keys were available. Model IDs are as given in the spec.
- Real STT has no benchmark audio corpus, so it is skipped by the benchmark and ranks last (still usable as failover).
- Real-mode LLM scoring is a length / no-markdown / language-script heuristic (no judge call); real TTS naturalness is a constant placeholder (0.5).
- Mock benchmarks use 6 tiny sentences per language, so WER granularity is coarse; Japanese is pre-segmented with spaces for word-level WER.
- Latency in mock mode is simulated, not measured; provider timeouts are only enforced for real adapters (20-30 s litellm timeout).
- Breaker state and faults are shared global state in SQLite; no auth on `/api/admin/*`.

## Next 3 things to build
1. Streaming turn pipeline (WebSocket, chunked STT/TTS) with time-to-first-byte as a routing metric.
2. A real audio benchmark corpus (e.g. synthesized with TTS or public datasets) plus an LLM-as-judge rubric, scheduled re-runs and benchmark history charts.
3. Per-request fallback policy and budget caps (timeouts per stage, hedged requests, cost ceilings) with tracing export.

*Not affiliated with Speko. Built for learning.*
