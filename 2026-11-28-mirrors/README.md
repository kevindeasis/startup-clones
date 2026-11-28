# Steer - a Mirrors clone

> Independent learning clone. **Not affiliated with, endorsed by, or derived from the source code of Mirrors, Inc.** Written from scratch from Mirrors' public pages.

## What the original does

[Mirrors](https://www.mirrors.dev) (YC F26, [YC page](https://www.ycombinator.com/companies/mirrors)) - "Find recurring agent mistakes. Steer them in real-time." It controls *what a production AI agent is told, and when*. Instead of growing a system prompt by one line per bug, you (1) see the mistakes an agent keeps making, (2) write a **correction** once, (3) **scope** it to the situations where it applies, (4) **preview** which past conversations it would have reached, (5) **activate** it so the guidance reaches the agent only at the matching step, and (6) **measure** outcomes with and without it. Integration is two SDK calls per turn (`get_context` before the model call, `capture_trace` after), fails open inside a time budget, and leaves model calls, tools and prompts in your app. Modes: `off`, `shadow`, `active`.

## What this clone does

- **Trace capture** (`POST /v1/traces`) with upsert by trace id, latest revision wins.
- **Mistake discovery** (`POST /v1/agents/{id}/discover`): Anthropic API when a key is set, deterministic heuristic detectors in mock mode.
- **Corrections** = guidance + scoped trigger (ANDed deterministic conditions: `message_matches`, `tool_called`, `tool_result_matches`, `user_segment`, `entry_point`, `turn_index_min`, plus optional natural-language `situation` judged by the LLM or by keyword fallback). Lifecycle `draft -> previewed -> active -> paused`; edits bump `version` and invalidate the preview.
- **Preview**: matched turns, near-miss *exclusions*, and *conflicts* with other active corrections.
- **Targeted delivery** (`POST /v1/context`): active corrections evaluated against the incoming trace; only treatment conversations (sha256 holdout split) receive the guidance, in `active` mode only. A delivery row is recorded either way (`delivered=0` in shadow/holdout).
- **Measurement**: per-correction treatment vs holdout conversations, success rates, lift, deliveries, still-repeating count.
- **Dashboard** (`steer/static/index.html`, vanilla JS): agents + mode switch, turn review, mistakes with "write correction" prefill, correction editor with preview, activate/pause, report bars/table. API key field (default `dev`) kept in localStorage, sent as `X-Steer-Key`.
- **Demo**: scripted subscription-support agent with two recurring mistakes (re-offers a discount after the customer declined; asks to restart after the customer already did).

**Skipped:** real auth/orgs/billing, TypeScript SDK, MCP server, traffic allocation beyond the holdout split, mode polling (SDK reads mode from the context response), Docker, async ingestion queue (ingestion is synchronous; the response still says `queued`).

## Architecture

```
agent harness --> steer_sdk (get_context / capture_trace, fail-open)
              --> FastAPI: /v1/context, /v1/traces
                    |-- trigger engine (triggers.py) + holdout split (holdout.py)
                    |-- LLM layer (llm.py): Anthropic client | MockLLM  (discovery, situation classifier, judge)
                    '-- sqlite (db.py): agents, turns, mistakes, corrections, deliveries
              --> report.py --> dashboard (static/index.html)
```

Files: `steer/{server,db,models,triggers,holdout,discovery,llm,report}.py`, `steer/static/index.html`, `steer_sdk/__init__.py`, `examples/{support_agent,demo}.py`, `tests/`.

## Open-source tools used

| Tool | Use |
|---|---|
| [FastAPI](https://github.com/fastapi/fastapi) | HTTP API, routing, validation, static UI |
| [uvicorn](https://github.com/encode/uvicorn) | ASGI server (also run in a thread by the demo) |
| [pydantic v2](https://github.com/pydantic/pydantic) | Trace/trigger/request models, regex validation |
| [httpx](https://github.com/encode/httpx) | SDK transport, demo client, tests |
| [anthropic](https://github.com/anthropics/anthropic-sdk-python) | Real-LLM path (`client.messages.create`) |
| [pytest](https://github.com/pytest-dev/pytest) | Test suite |
| sqlite3 (stdlib) | Storage |

## Setup and run

```bash
cd 2026-11-28-mirrors
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # optional; export the variables yourself, the app does not load .env

python -m pytest -q                                   # tests
STEER_MOCK=1 python -m examples.demo --serve          # self-contained demo, exit 0 on success
uvicorn steer.server:app --port 8790                  # server + dashboard at http://localhost:8790/
python -m examples.demo --api-url http://localhost:8790   # demo against a running server (fills the dashboard)
python -m examples.support_agent --conversations 20 --seed 1 --agent-id <id> --api-url http://localhost:8790 --tag baseline
```

SDK usage:

```python
from steer_sdk import Steer
steer = Steer(api_url="http://localhost:8790", api_key="dev", agent_id="ag_...")
ctx = steer.get_context(trace, timeout_ms=750)            # never raises; empty context on failure
system = base_system + ("\n\n" + ctx.context if ctx.context else "")
# ... your unchanged model call ...
steer.capture_trace(trace, final=True, terminal="completed", outcome={"success": True})
```

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Enables real LLM; absent means mock mode |
| `STEER_MOCK` | unset | `1` forces mock mode even with a key |
| `STEER_MODEL` | `claude-sonnet-5-5` | Model for discovery/classifier/judge |
| `STEER_API_KEY` | `dev` | Shared key required in `X-Steer-Key` on `/v1/*` |
| `STEER_DB` | `./.steer/steer.db` | sqlite path or `:memory:` |
| `STEER_API_URL` | `http://localhost:8790` | Used by SDK/demo |
| `STEER_PORT` | `8790` | Demo `--serve` port default |

The real LLM path calls `client.messages.create(model, max_tokens=4096, system, messages)` (no `thinking`, no `temperature`), reads the first text block, treats `refusal` as an error and `max_tokens` as an error only if the JSON is unparseable. Discovery falls back to heuristics on LLM failure; the semantic classifier fails closed. It is unit-tested with a fake client only; it has **not** been run against the live API.

## Known limitations

- Real-LLM path untested against the live API (no key in the build sandbox).
- Delivery is not de-duplicated per conversation; each `get_context` on a matching turn adds a delivery row (the report counts distinct conversations).
- Group assignment uses the first active delivery per conversation; changing the holdout percent mid-flight mixes groups.
- "Still repeating" uses the built-in detector library (discount re-offer, repeated restart); for custom corrections it counts nothing unless a detector fires.
- Editing an *active* correction keeps it active with no re-preview.
- SDK deadline relies on httpx per-phase timeouts, not a hard wall-clock cutoff.
- Preview scans up to 2,000 turns; semantic situations are classified for at most 100 turns per preview.
- Dashboard checked only by a headless-Chrome screenshot at 390px width and a DOM dump; no automated UI tests, console errors not inspected programmatically.
- Single shared API key, no rate limiting, sqlite with a global lock.

## Next 3 things to build

1. Pluggable outcome signals (judge on every final turn, user thumbs, tool-error rules) and per-correction significance tests on the lift.
2. Step-level scoping: deliver guidance mid-run (before tool calls) and per-correction mistake detectors derived from the discovery output, so "still repeating" works for any correction.
3. Background ingestion queue plus a hard wall-clock deadline in the SDK, a TypeScript SDK and mode polling.
