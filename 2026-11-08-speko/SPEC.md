# SPEC — Speko clone ("OpenRouter for Voice AI")

Independent learning clone. Not affiliated with Speko (YC S26). Original: Speko routes voice-agent traffic through one API/key to the speech-to-text (STT), LLM and text-to-speech (TTS) models that benchmarks show are best for a given language and use case, with failover. Public benchmarks site: benchmarks.speko.ai. YC page: https://www.ycombinator.com/companies/speko ; Launch HN: "Launch HN: Speko (YC S26) – OpenRouter for Voice AI".
Name the clone "Speko-lite" in the UI; folder is `2026-11-08-speko`.

## Product (what to build)
A voice-model gateway: one HTTP API that accepts a voice-agent "turn" (audio or text in) and a routing request `{language, use_case, priority}`, picks the best STT / LLM / TTS provider per stage using a benchmark table, calls it, fails over if it errors, and returns results with per-stage telemetry (provider chosen, latency, cost, fallback attempts). Plus a benchmark harness that produces the leaderboard that drives routing.

## Core flows (implement all 5)
1. **Benchmark run**: `POST /api/benchmarks/run` {languages, stages}. For each (provider, language) pair run a small built-in eval set (6 short reference sentences per language: en, es, de, hi, ja) through the provider; compute WER (STT, via `jiwer`), mean latency ms and cost per unit; for LLM compute a rubric score + latency + cost; for TTS compute latency + cost + a mock "naturalness" score. Persist rows in SQLite. `GET /api/benchmarks` returns the leaderboard (filter by stage/language).
2. **Routing decision**: `POST /api/route` {stage, language, use_case, priority: "quality"|"latency"|"cost"|"balanced"} returns ranked providers with a score breakdown and the selected one. Score = weighted normalized quality/latency/cost; weights depend on priority and use_case (e.g. "support_call" favors quality, "realtime_voice" favors latency). Providers lacking benchmark data for the language rank last.
3. **Voice turn pipeline**: `POST /api/turn` multipart (audio file OR `text`) + language/use_case/priority → routes STT → LLM → TTS, returns transcript, reply text, base64 audio (mock WAV beep/silence in mock mode), and a `trace` array: per stage {provider, latency_ms, cost_usd, attempts:[{provider, ok, error}]}.
4. **Failover**: if the chosen provider raises/timeouts, retry down the ranked list (max 3). A provider health table tracks recent failures and a circuit breaker excludes a provider for 60s after 3 consecutive failures. `POST /api/admin/fault` {provider, mode: "fail"|"slow"|"ok"} injects faults (for demo/tests); `GET /api/health` shows provider state.
5. **Dashboard**: single-page UI (served statically by FastAPI, vanilla HTML/JS, no build step) with tabs: Leaderboard (table + filter by language/stage, run-benchmark button), Router playground (form → ranked list with score bars), Voice turn (type text or upload audio, shows transcript/reply/audio player and the trace timeline with fallbacks highlighted), Health (providers with fault-injection buttons).

## Stack
Python 3.11+, FastAPI + uvicorn, SQLite via stdlib `sqlite3` (or SQLModel if easy), pydantic v2. Frontend: one `static/index.html` with inline JS/CSS.
Open-source libs (verified on PyPI): `fastapi`, `uvicorn`, `pydantic`, `jiwer` (WER, https://pypi.org/project/jiwer), `litellm` (https://github.com/BerriAI/litellm — unified calls for real providers: `litellm.completion`, `litellm.transcription`, `litellm.speech`), `httpx`, `python-multipart`, `pytest`.
Do NOT make `litellm` a hard import at startup: import lazily inside the real-provider adapters so mock mode works if install is slow; but list it in requirements.txt.

## Providers
Provider registry (config in `providers.py`) with STT: `mock-stt-alpha`, `mock-stt-beta`, `mock-stt-gamma`; LLM: `mock-llm-fast`, `mock-llm-smart`, `mock-llm-cheap`; TTS: `mock-tts-a`, `mock-tts-b`, `mock-tts-c`. Each mock has deterministic, seeded per-language characteristics (error rate, base latency, price) so that rankings differ by language (e.g. alpha best on en, beta best on hi/ja, gamma cheapest). Mock STT "transcribes" by taking the known reference text (from the eval-set audio id embedded in a fake audio payload, or the text field) and corrupting words with probability = provider/language error rate (seeded RNG) so jiwer yields real WERs. Real adapters (enabled only when env keys exist): STT `openai/whisper-1` via litellm.transcription, LLM `anthropic/claude-haiku-5-5` and `anthropic/claude-sonnet-5-5` via litellm.completion (`ANTHROPIC_API_KEY`), TTS `openai/tts-1` via litellm.speech. Real adapters must be implemented and type-check/import cleanly but cannot be tested without keys — say so in README.
`MOCK_MODE=1` default when no keys are present.

## Data model (SQLite)
- `benchmark_results(id, provider, stage, language, metric_quality REAL, latency_ms REAL, cost_usd REAL, n_samples INT, run_at TEXT)`
- `provider_health(provider PK, consecutive_failures INT, open_until TEXT, last_error TEXT, fault_mode TEXT)`
- `turns(id, created_at, language, use_case, priority, transcript, reply, trace_json)`
Seed the benchmark table on first start by running the benchmark once (fast, mock).

## Endpoints
`GET /api/health`, `GET /api/providers`, `POST /api/benchmarks/run`, `GET /api/benchmarks`, `POST /api/route`, `POST /api/turn`, `GET /api/turns`, `POST /api/admin/fault`, `GET /` (dashboard).

## LLM prompt design
System prompt for the agent reply: "You are a concise voice assistant. Reply in {language}, max 2 sentences, no markdown." Mock LLM returns a templated reply in the language. LLM benchmark rubric in mock mode: seeded score; in real mode: a judge call is out of scope — use length/language-match heuristic and document it.

## Env vars
`MOCK_MODE` (default 1), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` (default `./speko.db`), `PORT` (default 8000).

## Skip
Auth, billing, API-key management, real phone/WebRTC streaming, real benchmark audio corpora, multi-tenant anything.

## Acceptance checks (must all pass, and be scripted in `tests/test_api.py` with pytest + FastAPI TestClient, plus a `scripts/smoke.sh` that boots uvicorn and curls the endpoints)
A1. App boots in mock mode with no keys; `GET /` returns the dashboard HTML (200).
A2. `POST /api/benchmarks/run` populates rows for all providers × 5 languages; WER values are between 0 and 1 and differ across providers; `GET /api/benchmarks?stage=stt&language=hi` returns ranked rows.
A3. `/api/route` for `stt/en/quality` and `stt/hi/quality` select different providers (by design of mock data); `priority=cost` picks the cheapest.
A4. `/api/turn` with text input returns transcript, reply, audio base64 (valid WAV header), and a 3-stage trace.
A5. After `fault` {provider: <chosen stt>, mode: fail}, `/api/turn` still succeeds, the trace shows the failed attempt then the fallback; after 3 failures the breaker opens and the provider is skipped (attempts no longer include it) until `fault ok` + health reset.
A6. Unknown language/stage returns 422/400 with a clear message.
A7. `pytest` passes; `scripts/smoke.sh` passes.
