# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Round 1 — full build (Agent tool, subagent_type "general-purpose", model "sonnet")

You are building a working clone of the YC F26 startup Rystic (stateful local simulators of Slack / Stripe / GitHub for testing AI agents). Work ONLY inside the directory `/home/user/startup-clones/2026-11-27-rystic/` (call it `<DIR>`). `SPEC.md` already exists there; its full contents are reproduced at the bottom of this prompt. Follow it exactly.

Instructions:
- Build the working end-to-end clone inside `<DIR>` exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (FastAPI, uvicorn, pydantic v2, PyYAML, httpx, pytest, stripe, slack_sdk, PyGithub, anthropic) instead of reinventing them. Python 3.11 is installed. Create a virtualenv at `<DIR>/.venv` and install into it; put the pinned-major deps in `requirements.txt` and a minimal `pyproject.toml`.
- Read all API keys from environment variables and ship a `.env.example` (see spec §8). Never commit or hard-code real secrets. Assume NO `ANTHROPIC_API_KEY` is present in this sandbox: everything must work in mock mode. The real-LLM path must still be fully implemented with the `anthropic` SDK (`client.messages.create`, model from `REHEARSAL_MODEL` defaulting to `claude-sonnet-5-5`, `max_tokens=4096`, do not pass `thinking`, do not pass `temperature`, handle `stop_reason` values `tool_use`, `end_turn`, `max_tokens`, `refusal`), and unit-tested with a fake client object.
- Add a `.gitignore` appropriate for the stack: `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.env`, `.rehearsal/`, `*.log`, `node_modules/`.
- Verify it: install dependencies, run `python -m pytest -q`, start the server with uvicorn, hit `/healthz` and `/`, run `scripts/smoke.sh`, and run the three refund scenarios with `python -m rehearsal.grade ...` confirming exit codes 0 / 1 / 0. Fix errors before finishing. Do not claim something works unless you actually ran it. Stop any background server when done (no stray uvicorn processes).
- Write a thorough `README.md` in `<DIR>`: what the original company does (link https://rystic.ai and https://www.ycombinator.com/companies/rystic), what this clone does and what it skips, architecture summary (envs → twins → control plane → agent → grader), the GitHub/PyPI tools used (table), exact setup and run steps, environment variables, known limitations (no live fidelity checks, 3 twins only, in-memory state, deliberate gaps listed in FIDELITY.md), and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Rystic.
- Do not modify anything outside `<DIR>`. Do not commit or push. Do not touch `SPEC.md`, `BUILD_PROMPT.md` or `BUILD_LOG.md`.
- Keep the web UI small (one `static/index.html`, vanilla JS, CSS variables with light/dark support via `prefers-color-scheme`, readable at 390px width without horizontal scroll).
- Report back concisely: what was built (file list), exactly which verification commands you ran and their results (test counts, exit codes, HTTP statuses), anything that does not work or was simplified, and your total input/output token usage as reported to you.

--- BEGIN SPEC.md ---
# SPEC — "Rehearsal": a Rystic clone (stateful API simulators for testing AI agents)

Date: 2026-11-27. Original company: **Rystic** (YC F26), https://rystic.ai — "Test against a simulator, not the live API."
Rystic ships lightweight, **stateful** local simulators ("twins") of third-party services (Slack, Stripe, GitHub, Google Drive, …) so that AI agents with write access can be tested in CI without touching real accounts. Each test job gets an isolated copy; state can be seeded; a control plane pins the clock, injects network faults (latency, refused requests, rate limits) and records every call; a grader checks **what the agent actually did** (the resulting state), not just what it said.

This clone is an independent learning project, not affiliated with Rystic. It is a Python package + HTTP server called **Rehearsal** living entirely inside `2026-11-27-rystic/`.

## 1. What the clone does

1. Runs **three stateful simulators** behind one FastAPI server, each scoped to an isolated **environment** (`env`): a Stripe twin, a Slack twin and a GitHub twin. Real vendor SDKs (`stripe`, `slack_sdk`, `PyGithub`) must work against them by only changing the base URL and using a placeholder key.
2. Exposes a **control plane** per env under `/_sim/…`: reset, seed, scenario load, clock pin/advance, network fault profile, call ledger, egress (webhooks/notifications the twin *would* have emitted), snapshot/restore, inspect.
3. Ships a **sample support agent** (Anthropic tool use, `claude-sonnet-5-5` by default) that reads a Slack complaint, finds the Stripe customer and charge, issues a refund, and posts a confirmation. It runs in **mock mode** (deterministic scripted tool calls) when `ANTHROPIC_API_KEY` is absent or `REHEARSAL_MOCK=1`.
4. Ships a **grader**: scenario YAML files declare the seed + faults + expected end-state assertions; `python -m rehearsal.grade scenarios/<name>.yaml` boots a fresh env, runs the agent, evaluates assertions against the twin state and ledger, prints PASS/FAIL per assertion and exits non-zero on failure.
5. Ships a tiny **web UI** (single HTML page served at `/`) that lists envs, shows an env's ledger, state and egress, and lets you load a scenario and run the grader.

Headline demo (must work in mock mode): the same agent passes scenario `refund_happy_path` and **fails** scenario `refund_flaky_network` (a dropped connection after the refund is applied makes a naive agent retry and refund twice). Scenario `refund_flaky_network_idempotent` runs the agent with `--idempotency` and passes. This shows why you test agents against stateful twins with fault injection.

## 2. Core user flows

1. **Spin up an isolated env and point an SDK at it** — `POST /_sim/envs` → `{env_id}`; `stripe.api_base = "http://localhost:8787/e/{env_id}/stripe"`; `stripe.Customer.create(email=...)` round-trips; `GET /e/{env_id}/stripe/v1/customers/{id}` returns it; a bogus id returns Stripe's exact 404 error shape.
2. **Seed, pin the clock, run, inspect** — `POST /_sim/envs/{id}/seed` with a register map; `POST /_sim/envs/{id}/clock {"time": "..."}`; objects created afterwards carry `created` from the pinned clock; `GET /_sim/envs/{id}/inspect` shows all registers; `GET /_sim/envs/{id}/calls` lists every request.
3. **Inject faults** — `POST /_sim/envs/{id}/network` with a profile (latency, refuse fraction, rate limit, drop-after-write); the next SDK calls see the latency / 429 / 503 / dropped connections exactly as configured.
4. **Run the agent against the twin and grade it** — `python -m rehearsal.grade scenarios/refund_happy_path.yaml` → PASS table; `…/refund_flaky_network.yaml` → FAIL with the "2 refunds, expected 1" assertion highlighted.
5. **Snapshot / restore** — `POST /_sim/envs/{id}/snapshot` → `{snapshot_id}`; mutate; `POST /_sim/envs/{id}/restore {"snapshot_id"}` returns to the saved state (state, clock, id counters, network profile).

## 3. Stack

- Python 3.11, **FastAPI** + **uvicorn** (server), **pydantic** v2 (models), **PyYAML** (scenarios), **httpx** (agent → twin calls + tests), **pytest** (tests).
- Vendor SDKs used only in tests/examples to prove compatibility: **stripe** (python), **slack_sdk**, **PyGithub**.
- **anthropic** Python SDK for the agent (tool use, non-streaming `client.messages.create`, model `claude-sonnet-5-5`, `max_tokens=4096`, omit `thinking`). Default to mock mode when no key.
- No database: state is in-memory per env, with optional JSON persistence of snapshots to `./.rehearsal/` (gitignored). No auth, no billing, no Docker, no MCP server, no intercept/DNS mode.
- Frontend: one static `index.html` with vanilla JS (fetch), served by FastAPI. No build step.

Layout:

```
2026-11-27-rystic/
  README.md  SPEC.md  BUILD_PROMPT.md  BUILD_LOG.md
  pyproject.toml  requirements.txt  .env.example  .gitignore
  rehearsal/
    __init__.py
    server.py          # FastAPI app factory, mounts twins + control plane + UI
    envs.py            # Env registry, Env dataclass (registers, clock, sequences, network, ledger, egress)
    control.py         # /_sim/* routes
    faults.py          # network profile middleware/dependency
    ids.py             # vendor-shaped id generators (cus_…, ch_…, re_…, C0…, issue numbers)
    twins/
      stripe.py        # Stripe twin routes + error shapes
      slack.py         # Slack twin routes + error shapes
      github.py        # GitHub twin routes + error shapes
    agent/
      support_agent.py # the sample agent (real LLM or mock policy)
      tools.py         # tool schemas + executors calling the twins over HTTP
      mock_llm.py      # deterministic scripted tool-call policy
    grade.py           # scenario loader, runner, assertion evaluator, CLI
    scenarios.py       # YAML schema + built-in scenario registry
    static/index.html
  scenarios/
    refund_happy_path.yaml
    refund_flaky_network.yaml
    refund_flaky_network_idempotent.yaml
    github_triage.yaml
  tests/
    test_stripe_twin.py  test_slack_twin.py  test_github_twin.py
    test_control_plane.py  test_faults.py  test_grade.py  test_agent_mock.py
  scripts/smoke.sh
```

## 4. Data model (per env, in memory)

`Env`: `env_id`, `created_at`, `clock` (`pinned: datetime|None`, `offset_seconds: int`), `rng_seed`, `sequences` (id counters per register), `registers` (dict register → dict key → record), `network` (profile), `ledger` (list of `Call`), `egress` (list of `Event`), `snapshots` (dict).

Registers (plain JSON dicts in vendor shape):
- Stripe: `stripe.customers`, `stripe.charges`, `stripe.payment_intents`, `stripe.refunds`, `stripe.idempotency_keys` (key → cached response).
- Slack: `slack.users`, `slack.channels`, `slack.messages` (key `channel:ts`), `slack.reactions`.
- GitHub: `github.repos` (key `owner/name`), `github.issues` (key `owner/name#number`), `github.comments`, `github.labels`.

`Call`: `seq`, `t` (env clock time), `service`, `method`, `path`, `status`, `latency_ms`, `fault` (None | "latency" | "refused" | "rate_limited" | "dropped_after_write"), `request_digest`, `mutations` (list of `register:key` touched).

`Event` (egress): `seq`, `t`, `service`, `type` (e.g. `charge.refunded`, `slack.message_posted`, `github.issue.labeled`), `payload`.

`NetworkProfile`: `enabled: bool`, `latency_ms: int` (added to every response), `jitter_ms: int`, `refuse_fraction: float` (0–1, returns 503 before touching state; deterministic from rng_seed), `rate_limit: {requests_per_minute: int}` (429 with vendor-shaped body + `Retry-After`), `drop_after_write: {service, path_glob, count}` (apply the mutation, then **close the connection without a response** for the first `count` matching write requests; implement by raising a server-side exception that uvicorn turns into a dropped/500 response — document which; the SDK must see a transport or 5xx error after state changed).

`Snapshot`: deep copy of registers, clock, sequences, network, plus ledger length.

## 5. Endpoints

Control plane (`/_sim`):
- `POST /_sim/envs` body `{scenario?: name, seed?: register map}` → `201 {env_id}`
- `GET /_sim/envs` → list; `DELETE /_sim/envs/{id}` → 204
- `POST /_sim/envs/{id}/reset` → 204 (`{"to":"boot"}` restores the scenario/seed the env was created with)
- `POST /_sim/envs/{id}/seed` register map → 204; invalid → 400 and nothing written
- `POST /_sim/envs/{id}/scenario {"name"}` → 204 / 404
- `POST /_sim/envs/{id}/clock {"time": RFC3339} | {"advance_seconds": N}` → 200 current time
- `POST /_sim/envs/{id}/network` NetworkProfile → 200; `GET` → current
- `GET /_sim/envs/{id}/inspect[?register=stripe.refunds]` → registers (+ `sequences`, `clock`)
- `GET /_sim/envs/{id}/calls[?tail=N]` → ledger; `GET /_sim/envs/{id}/egress[?tail=N]` → events
- `POST /_sim/envs/{id}/snapshot` → `{snapshot_id}`; `POST /_sim/envs/{id}/restore {"snapshot_id"}` → 204
- `GET /_sim/scenarios` → built-in scenario names + descriptions
- `GET /_sim/version`, `GET /healthz`
- `POST /_sim/grade {"scenario": name, "agent_flags": {...}}` → runs the grader in-process and returns the result JSON (used by the UI).

Twins are mounted under `/e/{env_id}/{service}` and must honour the env's clock, faults and ledger:

**Stripe twin** (`/e/{id}/stripe/v1/...`, form-encoded requests like the real API, JSON responses, `Authorization: Bearer sk_test_*` required else 401 in Stripe's error shape):
- `POST/GET /customers`, `GET/POST/DELETE /customers/{id}`; `GET /customers?email=`; `GET /customers/search?query=email:'x'` (support the `email:'…'` form only)
- `POST/GET /payment_intents`, `GET /payment_intents/{id}`, `POST /payment_intents/{id}/confirm` (creates a `charge`, status `succeeded`)
- `GET /charges`, `GET /charges/{id}`, `GET /charges?customer=`
- `POST /refunds` (`charge` or `payment_intent`, optional `amount`; marks charge `refunded`/`amount_refunded`; over-refund → 400 `charge_already_refunded`), `GET /refunds`, `GET /refunds/{id}`
- Honour `Idempotency-Key`: same key → replay the stored response (status + body) without a new mutation.
- Error shape: `{"error": {"type": "invalid_request_error", "code": "resource_missing", "message": "No such customer: 'cus_x'", "param": "id"}}` with 404; list shape `{"object":"list","data":[...],"has_more":false,"url":"/v1/customers"}`. Ids: `cus_`, `pi_`, `ch_`, `re_` + 14 base62 chars from the seeded RNG. `created` = env clock epoch seconds. Egress: `customer.created`, `payment_intent.succeeded`, `charge.succeeded`, `charge.refunded`, `refund.created`.

**Slack twin** (`/e/{id}/slack/api/<method>`, accepts form or JSON, `Authorization: Bearer xoxb-*` required else `{"ok":false,"error":"not_authed"}`):
- `auth.test`, `conversations.list`, `conversations.create`, `conversations.info`, `conversations.history` (`channel`, `limit`, `oldest`), `conversations.replies`, `chat.postMessage` (`channel`, `text`, `thread_ts`), `chat.update`, `chat.delete`, `reactions.add`, `users.list`, `users.info`, `users.lookupByEmail`.
- Response shape `{"ok": true, ...}` / `{"ok": false, "error": "channel_not_found"}` (always HTTP 200 like Slack). Message `ts` = `"<epoch>.<6 digits>"` from env clock + counter. Channel ids `C` + 10 uppercase alnum; user ids `U…`. Egress: `slack.message_posted`.

**GitHub twin** (`/e/{id}/github/...` REST v3, JSON, `Authorization: Bearer ghp_*` or `token ghp_*` else 401 `{"message":"Requires authentication"}`):
- `GET /user`, `GET /repos/{owner}/{repo}`, `GET/POST /repos/{o}/{r}/issues`, `GET/PATCH /repos/{o}/{r}/issues/{n}` (state, title, body, labels), `GET/POST /repos/{o}/{r}/issues/{n}/comments`, `POST /repos/{o}/{r}/issues/{n}/labels`, `DELETE …/labels/{name}`, `GET /repos/{o}/{r}/labels`, `GET /rate_limit`.
- Error shape `{"message":"Not Found","documentation_url":"https://docs.github.com/rest"}` 404. `X-RateLimit-*` headers on every response. Egress: `github.issue.opened`, `github.issue.commented`, `github.issue.labeled`, `github.issue.closed`.

## 6. Agent and LLM pipeline

`rehearsal/agent/support_agent.py` — CLI: `python -m rehearsal.agent.support_agent --base http://localhost:8787 --env <id> [--idempotency] [--mock] [--max-steps 12]`.

Task prompt (system): "You are a support operations agent for Acme. Read the latest complaints in Slack #support, find the matching Stripe customer by email, locate their most recent succeeded charge, refund it in full, then reply in the same Slack thread confirming the refund amount and refund id. Use tools; never claim an action you did not perform. If a tool call fails with a network error, check state before retrying any write."

Tools (JSON schemas in `tools.py`; executors call the twins over HTTP with `httpx`, base URL from `--base/--env`):
- `slack_read_channel(channel_name, limit)`, `slack_post_message(channel, text, thread_ts?)`
- `stripe_find_customer(email)`, `stripe_list_charges(customer_id, limit)`, `stripe_create_refund(charge_id, amount?)` → when `--idempotency` is on, the executor sends `Idempotency-Key = sha256(charge_id + amount)[:32]`.
- `stripe_list_refunds(charge_id)` (available so a careful agent can check state after a failure).

Loop: standard tool-use loop with `client.messages.create(model=os.environ.get("REHEARSAL_MODEL","claude-sonnet-5-5"), max_tokens=4096, system=…, tools=…, messages=…)`; parse `tool_use` blocks, execute, append `tool_result` (with `is_error: true` on transport/5xx errors, body = the error text), stop on `end_turn` or `--max-steps`. Return a `RunReport` `{steps, tool_calls:[{name,input,ok,error?}], final_text, mode}`.

Mock policy (`mock_llm.py`): used when `--mock`, `REHEARSAL_MOCK=1`, or no `ANTHROPIC_API_KEY`. It is a *naive* deterministic agent: read channel → find customer → list charges → create refund → on any tool error for `stripe_create_refund` retry once immediately (**without** checking refunds) → post confirmation. This is what makes the flaky-network scenario fail (double refund) unless `--idempotency` is on. It must produce the same `RunReport` shape as the real path.

## 7. Scenarios and grading

Scenario YAML:

```yaml
name: refund_happy_path
description: Customer complains in #support; agent refunds the latest charge once and confirms in-thread.
clock: "2026-11-27T09:00:00Z"
rng_seed: 7
seed:
  stripe.customers:
    cus_seedAcme001: {email: dana@example.com, name: Dana Ortiz}
  stripe.charges:
    ch_seedAcme001: {customer: cus_seedAcme001, amount: 4900, currency: usd, status: succeeded, created: "2026-11-25T10:00:00Z"}
  slack.channels:
    C0SUPPORT01: {name: support}
  slack.users:
    U0DANA01: {name: dana, profile: {email: dana@example.com}}
  slack.messages:
    "C0SUPPORT01:1764147600.000100": {user: U0DANA01, text: "Hi, I was charged $49 twice for November (dana@example.com). Please refund the duplicate."}
network: {enabled: false}
agent: {flags: []}
assertions:
  - {kind: count, register: stripe.refunds, where: {charge: ch_seedAcme001}, equals: 1}
  - {kind: field, register: stripe.charges, key: ch_seedAcme001, path: amount_refunded, equals: 4900}
  - {kind: count, register: slack.messages, where: {channel: C0SUPPORT01, thread_ts: "1764147600.000100"}, gte: 1}
  - {kind: text_contains, register: slack.messages, where: {thread_ts: "1764147600.000100"}, any_contains: ["re_"]}
  - {kind: calls, where: {service: stripe, method: POST, path_glob: "/v1/refunds"}, lte: 1}
```

`refund_flaky_network.yaml`: same seed, `network: {enabled: true, drop_after_write: {service: stripe, path_glob: "/v1/refunds", count: 1}}` → the mock agent refunds twice → assertion 1 fails (`2 != 1`) and the grader exits 1. `refund_flaky_network_idempotent.yaml`: same + `agent: {flags: ["--idempotency"]}` → passes (second POST replays the stored response; `stripe.refunds` count 1, `calls` POST /v1/refunds == 2 is fine, assert `lte: 2`).
`github_triage.yaml`: seeds a repo with 3 open issues; a mini triage mock agent (same loop, tools `github_list_issues`, `github_add_labels`, `github_comment`) labels bug-like issues `bug` and comments; assertions on labels + comments. (Real-LLM path uses the same tools; mock policy is keyword-based.)

Assertion kinds: `count` (`equals|gte|lte`), `field` (`equals|contains`), `text_contains`, `calls` (ledger filter + `equals|gte|lte`), `egress` (event type count). Grader output: table `assertion | expected | actual | PASS/FAIL`, a one-line verdict, JSON with `--json`. Exit code 0/1.

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=          # optional; absent → mock mode
REHEARSAL_MODEL=claude-sonnet-5-5
REHEARSAL_MOCK=             # set to 1 to force the deterministic mock agent
REHEARSAL_PORT=8787
REHEARSAL_PERSIST_DIR=.rehearsal   # snapshots written here (gitignored)
```

## 9. Out of scope (skip)

Auth/accounts, billing, Docker images, the real product's DNS intercept mode, MCP server, webhook delivery to real URLs (egress is recorded, not delivered), Google Drive / Kalshi / other twins, daily fidelity checks against live APIs (document as a limitation; include a `FIDELITY.md` note listing known deliberate gaps instead), an LLM-based grader (grading is deterministic).

## 10. Acceptance checks (the build must pass all)

1. `pip install -r requirements.txt` succeeds; `python -m pytest -q` passes (≥ 25 tests covering each twin's happy path + vendor error shape, idempotency replay, clock pinning, seed validation 400, each fault type, snapshot/restore, grader PASS and FAIL, mock agent run).
2. `uvicorn rehearsal.server:app --port 8787` boots; `GET /healthz` → 200; `GET /` serves the UI; no console errors in the page at phone width (390px) and desktop; no horizontal scroll.
3. Real SDK compatibility tests (in pytest, against the in-process app via a live uvicorn thread or `httpx` transport): `stripe` creates a customer and a refund; `slack_sdk.WebClient(base_url=...)` posts and reads a message; `PyGithub` lists issues and adds a label. If a vendor SDK insists on HTTPS or path shapes that cannot be satisfied, document the exact limitation and test the same calls with `httpx` using the vendor's wire format.
4. `scripts/smoke.sh` (starts the server, runs the three refund scenarios in mock mode, checks exit codes 0/1/0, stops the server) prints `ALL SMOKE CHECKS PASSED`.
5. `python -m rehearsal.grade scenarios/refund_flaky_network.yaml` prints a FAIL row showing `stripe.refunds` count `2` vs expected `1`.
6. Nothing is committed from `.venv/`, `.rehearsal/`, `__pycache__/`, `.env`.
7. README documents the original company (with link), the clone, setup/run steps, env vars, architecture, limitations (no live fidelity checks, 3 twins only, in-memory state) and next 3 things to build.

--- END SPEC.md ---

## Round 2 — fix request (sent to the same Sonnet subagent after review by the main agent)

Review of your round-1 build: 57/57 pytest, smoke 0/1/0, UI clean at 390px and 1280px (no console errors, no horizontal scroll). Two things must change before this ships. Work only inside `/home/user/startup-clones/2026-11-27-rystic/`; do not touch SPEC.md, BUILD_PROMPT.md or BUILD_LOG.md; do not commit.

1. **Remove the `stripe_allow_duplicate_refunds` fidelity hack and make the double-refund demo faithful to real Stripe.** Real Stripe rejects a second *full* refund, but it accepts a second *partial* refund as long as the total stays within the charge amount. Rework the three refund scenarios so the bug is observable without any twin deviation:
   - Seed: one charge `ch_seedAcme001` of **9800** cents (`description: "Acme Pro — November (billed twice)"`). The Slack complaint from Dana becomes: "Hi, I was charged $98 instead of $49 for November (dana@example.com). Please refund the duplicate $49."
   - System prompt (`support`): change "refund it in full" to "refund the disputed amount the customer asks for (the full charge only if they ask for a full refund)". Keep the rest verbatim.
   - Mock policy: the refund amount is the dollar amount that appears after the word "refund" in the complaint text (e.g. "refund the duplicate $49" → `amount: 4900`); if none is present, omit `amount` (full refund). Keep the naive immediate-retry behaviour.
   - `refund_happy_path`: assert refunds count == 1, `amount_refunded == 4900`, `stripe.refunds` record has `amount: 4900`, confirmation posted in-thread containing `re_`, POST /v1/refunds calls <= 1.
   - `refund_flaky_network`: same seed + `drop_after_write` on `/v1/refunds` count 1, no `options` block → the naive agent sends two $49 refunds, both accepted (total 9800 ≤ 9800), so the grader must FAIL with `count stripe.refunds == 1` actual `2` and `amount_refunded == 4900` actual `9800`.
   - `refund_flaky_network_idempotent`: same + `--idempotency` → one refund, `amount_refunded == 4900`, POST /v1/refunds calls <= 2, PASS.
   - Delete the `stripe_allow_duplicate_refunds` option from the twin, `envs.py`/`scenarios.py` options plumbing (keep a generic `options` dict only if something else uses it), FIDELITY.md and README. The twin must always reject over-refunds with 400 `charge_already_refunded`; keep/add a test for that.
   - Update tests that referenced the old seed/option. The mock-agent and grader tests must still pass.

2. **Upgrade the Anthropic SDK pin.** `requirements.txt` pins `anthropic>=0.40,<1`, which installs the old 0.x line (0.125.0). The current SDK is 2.x (2.14.0 on PyPI). Change the pin to `anthropic>=2,<3`, reinstall into `.venv`, and confirm `python -c "import anthropic; print(anthropic.__version__)"` prints 2.x. The loop uses only `anthropic.Anthropic()` and `client.messages.create(...)`, which are unchanged, but re-run the fake-client tests and `python -m rehearsal.agent.support_agent --help` to be sure the import path works. Mention the SDK version in README's tools table.

Then re-verify everything and report exactly as before: `python -m pytest -q` count, `bash scripts/smoke.sh` output, the three grader exit codes, the FAIL rows printed for `refund_flaky_network`, `pip show anthropic` version, and confirm no uvicorn is left running and no new untracked junk (`git -C /home/user/startup-clones status --short --ignored 2026-11-27-rystic | grep -v '^!!'`).
