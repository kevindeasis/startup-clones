# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Round 1 — full build (Agent tool, subagent_type "general-purpose", model "sonnet")

You are building a working clone of the YC F26 startup Mirrors (real-time, scoped, measured corrections for production AI agents). Work ONLY inside the directory `/home/user/startup-clones/2026-11-28-mirrors/` (call it `<DIR>`). `SPEC.md` already exists there; its full contents are reproduced at the bottom of this prompt. Follow it exactly.

Instructions:
- Build the working end-to-end clone inside `<DIR>` exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (FastAPI, uvicorn, pydantic v2, httpx, pytest, anthropic; stdlib sqlite3) instead of reinventing them. Python 3.11 is installed. Create a virtualenv at `<DIR>/.venv` (`python3 -m venv .venv`) and install into it; put the deps with pinned majors in `requirements.txt` (e.g. `fastapi>=0.115,<1`, `uvicorn>=0.30,<1`, `pydantic>=2,<3`, `httpx>=0.27,<1`, `pytest>=8,<10`, `anthropic>=2,<3`) and a minimal `pyproject.toml`.
- Read all API keys from environment variables and ship a `.env.example` (see spec §8). Never commit or hard-code real secrets. Assume NO `ANTHROPIC_API_KEY` is present in this sandbox: everything must work in mock mode. The real-LLM path must still be fully implemented with the `anthropic` SDK (`client.messages.create`, model from `STEER_MODEL` defaulting to `claude-sonnet-5-5`, `max_tokens=4096`, do not pass `thinking`, do not pass `temperature`; read text from the first text content block; handle `stop_reason` `max_tokens` and `refusal` gracefully), and unit-tested with a fake client object.
- Add a `.gitignore` appropriate for the stack: `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.env`, `.steer/`, `*.db`, `*.log`, `node_modules/`.
- Verify it: install dependencies, run `python -m pytest -q`, start the server with uvicorn, hit `/healthz` and `/`, run `STEER_MOCK=1 python -m examples.demo --serve` and confirm exit code 0 with treatment > holdout, then run the demo against a separately started server (`--api-url http://localhost:8790`, no `--serve`) and confirm the dashboard endpoints (`/v1/agents`, `/v1/agents/{id}/turns`, `/v1/agents/{id}/mistakes`, `/v1/agents/{id}/corrections`, `/v1/corrections/{id}/report`) return the demo data. Fix errors before finishing. Do not claim something works unless you actually ran it. Stop any background server when done (no stray uvicorn processes).
- Write a thorough `README.md` in `<DIR>`: what the original company does (link https://www.mirrors.dev and https://www.ycombinator.com/companies/mirrors), what this clone does and what it skips, architecture summary (harness → SDK → capture/context API → trigger engine + holdout → LLM/mock → sqlite → dashboard), the GitHub/PyPI tools used (table), exact setup and run steps, environment variables, known limitations, and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Mirrors, Inc.
- Do not modify anything outside `<DIR>`. Do not commit or push. Do not touch `SPEC.md`, `BUILD_PROMPT.md` or `BUILD_LOG.md`.
- Keep the web UI small (one `steer/static/index.html`, vanilla JS, CSS variables with light/dark support via `prefers-color-scheme`, readable at 390px width without horizontal scroll). It needs an API-key field (default `dev`) stored in localStorage and sent as `X-Steer-Key`.
- Report back concisely: what was built (file list), exactly which verification commands you ran and their results (test counts, exit codes, HTTP statuses, the demo's printed report numbers), anything that does not work or was simplified, and your total input/output token usage as reported to you.

--- BEGIN SPEC.md ---
# SPEC — "Steer": a Mirrors clone (real-time, scoped corrections for production AI agents)

Date: 2026-11-28. Original company: **Mirrors** (YC F26), https://www.mirrors.dev — "Find recurring agent mistakes. Steer them in real-time."
YC page: https://www.ycombinator.com/companies/mirrors · Launch post: https://www.ycombinator.com/launches/WGV-mirrors-fix-recurring-ai-agent-mistakes-with-real-time-guidance

Mirrors is infrastructure that controls *what a production AI agent is told, and when*. Instead of patching every recurring mistake by adding one more line to an ever-growing system prompt, a developer (1) sees the mistakes an agent keeps making across production runs, (2) writes a **correction** once, (3) **scopes** it to the situations where it applies, (4) **previews** which past conversations it would have reached, (5) **activates** it so the agent receives that guidance only at the matching step of a run, and (6) **measures** outcomes with and without it. Integration is two SDK calls per user turn (`get_context` before the model call, `capture_trace` after), fails open within a time budget, and leaves model calls, tools and prompts in the application. Runtime modes: `off`, `shadow`, `active`.

This clone is an independent learning project, not affiliated with Mirrors, Inc. It is written from scratch from Mirrors' public pages and docs; it must not copy any Mirrors source or SDK code. The clone is a Python package + HTTP server + Python SDK called **Steer**, living entirely inside `2026-11-28-mirrors/`.

## 1. What the clone does

1. **Trace capture**: an agent harness sends each turn's original conversation (messages + tool calls + how it ended) through the SDK; the server stores it per agent.
2. **Mistake discovery**: `POST /v1/agents/{id}/discover` groups the agent's unsuccessful turns into *recurring mistakes* (title, description, evidence turns, a suggested correction with a suggested trigger). Uses the Anthropic API when a key is present; a deterministic heuristic in mock mode.
3. **Corrections with scoped triggers**: a correction = plain-language `guidance` + a `trigger` (deterministic conditions ANDed together, plus an optional natural-language `situation` evaluated by the LLM, or by keyword fallback in mock mode). Lifecycle: `draft → previewed → active → paused`.
4. **Preview**: runs a correction's trigger over all stored turns for the agent and returns the turns it would have reached, near-misses (turns that match some but not all conditions, listed as *exclusions*), and conflicts (other active corrections whose triggers overlap). Editing a correction invalidates its preview.
5. **Targeted real-time delivery**: `POST /v1/context` evaluates all *active* corrections against the incoming trace and returns the matching guidance as plain text to append to the system prompt — only in `active` mode, only for conversations in the treatment group (deterministic holdout split), and records a *delivery* row either way so reach is visible.
6. **Outcome measurement**: outcomes (`success` bool + optional note) arrive with the final capture or via a separate call. Per-correction report: delivered vs held-out conversations, success rate for each, lift, and whether the original mistake still repeats.
7. **Dashboard** (single static HTML page): agents + mode switch, turn review (messages, tool calls, outcome), mistakes list with "write correction" prefill, correction editor with preview results, activate/pause, and the report.
8. **Demo**: a scripted subscription-support agent whose mock LLM has two recurring mistakes (re-offers a retention discount after the customer declined; restarts troubleshooting the customer already did). `python -m examples.demo --serve` runs baseline conversations, discovers the mistakes, creates + previews + activates a correction with a 50% holdout, runs more conversations, and prints the report, which must show the treatment group outperforming the holdout.

## 2. Core user flows

1. **Integrate in two calls** — in the harness: `ctx = steer.get_context(trace, timeout_ms=750)`; `system = base_system + ("\n\n" + ctx.context if ctx.context else "")`; model call unchanged; `steer.capture_trace(trace, final=True, terminal="completed", outcome={"success": True})`. If the server is down or slow, `get_context` returns empty context within the budget and the agent runs unchanged (fail-open).
2. **Find the recurring mistake** — dashboard "Discover mistakes" (or `POST /v1/agents/{id}/discover`) → list like "Re-offers retention discount after the customer already declined (7 turns)" with evidence links and a suggested guidance + trigger.
3. **Write, scope, preview** — create correction `{title, guidance, trigger}`; `POST /v1/corrections/{id}/preview` → `{matched: [...], exclusions: [...], conflicts: [...]}`; the dashboard lists each matched turn with the conditions that matched.
4. **Activate with a holdout** — `POST /v1/corrections/{id}/activate {"holdout_pct": 50}`; agent mode set to `active`; subsequent `get_context` calls for matching turns return the guidance for treatment conversations only.
5. **Measure** — `GET /v1/corrections/{id}/report` → `{treatment: {conversations, successes, rate}, holdout: {...}, lift, deliveries, still_repeating: n}`; dashboard shows it as two bars + a table.

## 3. Stack

- Python 3.11, **FastAPI** + **uvicorn** (server), **pydantic** v2 (request/response models), **sqlite3** from the standard library (file DB at `./.steer/steer.db`, gitignored; `STEER_DB=:memory:` for tests), **httpx** (SDK transport + tests), **pytest** (tests).
- **anthropic** Python SDK (≥ 2.0) for the three LLM jobs (discovery, semantic trigger classification, optional outcome judge). Model from `STEER_MODEL`, default `claude-sonnet-5-5`; non-streaming `client.messages.create`, `max_tokens=4096`, do not pass `thinking` or `temperature`; parse JSON out of the text block defensively. Mock mode (`STEER_MOCK=1` or no `ANTHROPIC_API_KEY`) must make everything work deterministically.
- Frontend: one `steer/static/index.html`, vanilla JS (`fetch`), CSS variables with light/dark via `prefers-color-scheme`, readable at 390px width without horizontal scroll. No build step, no framework.
- Skip: auth beyond a single shared API key header (`X-Steer-Key`, compared to `STEER_API_KEY`, default `dev`), billing, multi-tenant orgs, TypeScript SDK, MCP server, traffic allocation beyond the holdout split, mode-refresh polling (the SDK reads the mode from the context response), Docker.

Layout:

```
2026-11-28-mirrors/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  pyproject.toml  requirements.txt  .env.example  .gitignore
  steer/
    __init__.py
    server.py        # FastAPI app factory: routes, static UI, startup (DB init)
    db.py            # sqlite3 schema + thin repository functions
    models.py        # pydantic models: Trace, Message, ToolCall, Correction, Trigger, Outcome, reports
    triggers.py      # deterministic trigger evaluation + preview (matched / exclusions / conflicts)
    holdout.py       # deterministic treatment/holdout assignment (sha256 of conversation_id + correction_id)
    discovery.py     # recurring-mistake discovery: LLM path + mock heuristic path
    llm.py           # Anthropic client wrapper + MockLLM; JSON extraction; semantic trigger classifier
    report.py        # per-correction measurement
    static/index.html
  steer_sdk/
    __init__.py      # Steer client: get_context(trace, timeout_ms, ...), capture_trace(trace, final, terminal, outcome), start_turn()
  examples/
    support_agent.py # scripted subscription-support agent with a MockLLM that exhibits the two mistakes
    demo.py          # end-to-end demo (--serve starts uvicorn in a thread)
  tests/
    test_triggers.py test_holdout.py test_api.py test_sdk.py test_discovery.py test_report.py test_llm.py test_demo.py
```

## 4. Data model (sqlite)

- `agents(id TEXT PK, name TEXT, mode TEXT CHECK in off|shadow|active DEFAULT 'shadow', system_prompt_hint TEXT, created_at)`
- `turns(trace_id TEXT PK, agent_id, conversation_id, revision INTEGER, entry_point TEXT, user_id TEXT, user_segment TEXT, messages_json TEXT, terminal TEXT (completed|failed|canceled|NULL), final INTEGER, outcome_success INTEGER NULL, outcome_note TEXT, latency_ms INTEGER, created_at)` — repeated captures for the same `trace_id` upsert (latest revision wins).
- `mistakes(id TEXT PK, agent_id, title, description, evidence_json (list of trace_ids), suggested_guidance, suggested_trigger_json, created_at)`; a discovery run replaces the agent's previous mistakes.
- `corrections(id TEXT PK, agent_id, title, guidance, trigger_json, status TEXT (draft|previewed|active|paused), holdout_pct INTEGER DEFAULT 0, version INTEGER, preview_json TEXT NULL, created_at, activated_at)`; any edit increments `version`, clears `preview_json`, and sets status back to `draft` if it was `previewed`.
- `deliveries(id INTEGER PK, correction_id, trace_id, conversation_id, group_name TEXT (treatment|holdout), delivered INTEGER, mode TEXT, created_at)`.

Trace schema (JSON, built-in types only, ≤ 1,000,000 bytes, ≤ 10,000 messages):

```json
{
  "id": "trace uuid (one per user turn)",
  "conversationId": "groups turns of one conversation",
  "conversationRevision": 3,
  "entryPoint": "chat" ,
  "user": {"id": "u_123", "segment": "pro"},
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "...", "toolCalls": [{"callId": "c1", "name": "offer_discount", "arguments": {"pct": 20}}]},
    {"role": "tool", "callId": "c1", "name": "offer_discount", "content": "{\"accepted\": false}"}
  ],
  "turnLatencyMs": 1234
}
```

Trigger schema: `{"all": [condition, ...], "situation": "optional natural-language situation", "situation_keywords": ["optional", "mock fallback"]}` where a condition is one of
`{"type":"message_matches","role":"user|assistant|any","pattern":"regex","where":"last|any"}`,
`{"type":"tool_called","name":"offer_discount","min_count":1}`,
`{"type":"tool_result_matches","name":"offer_discount","pattern":"regex"}`,
`{"type":"user_segment","in":["pro","enterprise"]}`,
`{"type":"entry_point","in":["chat"]}`,
`{"type":"turn_index_min","value":2}` (position of this turn within its conversation, from `conversationRevision`).
A trigger matches when every condition matches AND (no `situation` OR the classifier says yes). Regexes compile with `re.IGNORECASE`; invalid regexes are rejected at create time with 422.

## 5. Endpoints

- `GET /healthz` → `{"ok": true, "mock": bool}`
- `GET /` → dashboard; `GET /static/...`
- Agents: `GET /v1/agents`, `POST /v1/agents {name, mode?}`, `GET /v1/agents/{id}`, `PATCH /v1/agents/{id} {mode?, name?}`
- Capture: `POST /v1/traces {agentId, trace, final, terminal?, outcome?}` → `{status: "accepted", traceId, ingestion: {status: "queued"}}`
- Turns: `GET /v1/agents/{id}/turns?limit&conversationId&failed_only`, `GET /v1/turns/{trace_id}`, `POST /v1/turns/{trace_id}/outcome {success, note?}`
- Context: `POST /v1/context {agentId, trace}` → `{context: "", mode, delivery: "accepted"|"unconfirmed", reason, elapsed_ms, corrections: [ids delivered]}`. In `shadow` mode: evaluate, record deliveries with `delivered=0`, return empty context. In `off`: return empty immediately. In `active`: deliver to treatment conversations only. Guidance text format when several match: each correction rendered as `"- <guidance>"` under a one-line header `"Guidance for this situation:"`.
- Discovery: `POST /v1/agents/{id}/discover {max_turns?: 200}` → `{mistakes: [...]}`; `GET /v1/agents/{id}/mistakes`
- Corrections: `GET /v1/agents/{id}/corrections`, `POST /v1/corrections {agentId, title, guidance, trigger}`, `GET/PATCH/DELETE /v1/corrections/{id}`, `POST /v1/corrections/{id}/preview`, `POST /v1/corrections/{id}/activate {holdout_pct}` (409 if no fresh preview for the current version), `POST /v1/corrections/{id}/pause`, `GET /v1/corrections/{id}/report`
- All `/v1/*` routes require `X-Steer-Key` equal to `STEER_API_KEY` (default `dev`) → 401 otherwise. `/healthz` and `/` are open.

## 6. LLM prompt / pipeline design

- **Discovery** (`discovery.py`): take up to `max_turns` most recent *final* turns, prefer `outcome_success == 0`, compress each to ≤ 1,200 chars (last 6 messages, tool names + truncated results). Prompt: system = "You review production transcripts of an AI agent and find recurring mistakes…"; user = the compressed turns as a numbered list; ask for JSON `{"mistakes":[{"title","description","evidence":[turn numbers],"suggested_guidance","suggested_trigger":{...trigger schema...}}]}` with 1–5 mistakes, each with ≥ 2 evidence turns. Map turn numbers back to trace_ids; drop mistakes with < 2 valid evidence turns. **Mock heuristic**: a small library of detectors over failed turns, e.g. "discount re-offered after decline" = `offer_discount` tool called ≥ 2 times in a conversation where a user message matches `no thanks|just cancel|don't want`; "troubleshooting restarted" = assistant asks to restart/reboot after a user message matches `already (tried|restarted|rebooted)`; group by detector, require ≥ 2 turns, emit title/description/guidance/trigger from the detector's template.
- **Semantic trigger classifier** (`llm.py`): for a trigger with `situation`, prompt the model with the compressed trace and the situation text, ask for JSON `{"matches": true|false, "reason": "..."}`. Mock fallback: any `situation_keywords` present (case-insensitive) in the user/tool messages. Preview and `get_context` both use it; `get_context` must finish inside the request budget, so cap the classifier at one call per correction with `timeout` on the Anthropic client set to the remaining budget, and fail closed for that correction (no delivery) on timeout.
- **Outcome judge** (optional, `POST /v1/turns/{id}/judge`): if a final turn has no outcome, ask the model whether the user's goal was achieved → `{success, note}`. Mock: success unless the last user message matches a frustration regex (`frustrat|already said|this is useless|stop offering`). The demo relies on explicit outcomes, not the judge.

## 7. Demo agent (`examples/support_agent.py`)

Scripted subscription-support harness using the `steer_sdk` client. Tools: `lookup_account`, `offer_discount`, `cancel_subscription`, `send_troubleshooting_step`. MockLLM is deterministic given a seed and the system prompt. Scenario mix per conversation (seeded RNG): 40% "cancel" (customer wants to cancel; agent offers 20% discount; customer declines; **buggy behavior**: re-offers discount → customer frustrated → outcome failure; **with guidance** containing the phrase "do not offer" or "already declined" in the system prompt → cancels → success), 30% "troubleshoot" (customer says they already restarted; buggy: asks to restart again → failure; with guidance mentioning "already tried" → continues → success), 30% "billing question" (always succeeds). Each conversation is 2–3 turns; each turn calls `get_context` then `capture_trace(final=True, outcome=...)`. Flags: `--conversations N --seed S --agent-id ID --api-url URL --tag baseline|after`.

`examples/demo.py --serve [--port 8790]`: starts uvicorn in a thread (mock mode), creates agent "support-bot" in `shadow`, runs 40 baseline conversations, calls discover, asserts the discount mistake is found, creates a correction from the first suggestion (guidance must contain "already declined" and "do not offer"), previews (prints matched/exclusion counts), activates with `holdout_pct=50`, flips agent mode to `active`, runs 60 more conversations, fetches the report and prints a small table; exits 0 only if treatment success rate > holdout success rate and `still_repeating` counts fewer repeats in treatment than holdout. Must complete in < 60 s.

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # optional; absent → mock mode
STEER_MOCK=                   # set to 1 to force mock mode even with a key
STEER_MODEL=claude-sonnet-5-5
STEER_API_KEY=dev             # shared key checked on /v1/*
STEER_DB=./.steer/steer.db    # sqlite path or :memory:
STEER_API_URL=http://localhost:8790   # used by the SDK/demo
STEER_PORT=8790
```

## 9. Acceptance checks

1. `python -m pytest -q` passes with ≥ 25 tests covering: every trigger condition type (match + non-match), preview exclusions/conflicts, holdout determinism (same conversation → same group; roughly 50/50 over 1,000 ids at 50%), API key 401, capture upsert by revision, `get_context` behaviour in `off`/`shadow`/`active`, deliveries recorded in shadow with `delivered=0`, activation 409 without preview and after an edit, report math, mock discovery finds both demo mistakes, SDK fail-open (unreachable URL → empty context within `timeout_ms + 250ms`; server 500 → empty context), real-LLM path with a fake Anthropic client object (discovery JSON parsing incl. fenced JSON, classifier yes/no, timeout → fail closed).
2. `STEER_MOCK=1 python -m examples.demo --serve` exits 0 and prints baseline success rate, the discovered mistakes, preview counts, and a report where treatment rate > holdout rate.
3. `uvicorn steer.server:app --port 8790` boots; `GET /healthz` → 200; `GET /` serves the dashboard which lists agents, turns, mistakes, corrections and the report after the demo has run against it; no horizontal scroll at 390px; no console errors.
4. `git status` inside the folder shows no `.venv`, `.steer/`, `__pycache__`, `.pytest_cache`, `.env`.
5. README documents all of the above plus limitations and next steps.
--- END SPEC.md ---
