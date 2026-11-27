# Rehearsal - a Rystic clone (stateful API simulators for testing AI agents)

> **Independent learning clone. Not affiliated with, endorsed by, or derived from the code of Rystic.**
> Built from the public one-line description of the company only.

## The original company

**Rystic** (YC F26) - "Test against a simulator, not the live API." Rystic ships lightweight, *stateful* simulators
("twins") of third-party services (Slack, Stripe, GitHub, Google Drive, ...) so AI agents with write access can be tested
in CI without touching real accounts. Each test job gets an isolated copy of the world; state can be seeded; a control plane
pins the clock, injects network faults and records every call; and a grader checks *what the agent actually did* (the
resulting state), not just what it said.

- Website: https://rystic.ai
- YC profile: https://www.ycombinator.com/companies/rystic

## What this clone does

Rehearsal is a Python package + FastAPI server (`rehearsal/`) that provides:

1. **Three stateful twins** - Stripe, Slack, GitHub - each scoped to an isolated *env* and mounted at
   `/e/{env_id}/{stripe|slack|github}`. The real `stripe`, `slack_sdk` and `PyGithub` SDKs work against them by changing
   only the base URL and using a placeholder key (covered by tests).
2. **A control plane** at `/_sim/*`: create/reset/delete envs, seed registers, load scenarios, pin/advance the clock,
   set a network fault profile (latency, jitter, refused requests, rate limits, drop-after-write), read the call ledger and
   egress events (webhooks the twin *would* have sent), snapshot/restore, inspect all state.
3. **A sample agent** (`rehearsal/agent/`): a Slack-complaint -> Stripe-refund support agent and a GitHub issue-triage
   agent, using Anthropic tool use. It runs against the real model when `ANTHROPIC_API_KEY` is set, or a deterministic,
   deliberately *naive* mock policy otherwise.
4. **A grader** (`rehearsal/grade.py`): scenario YAML = seed + clock + faults + end-state assertions. It boots a fresh env,
   runs the agent, evaluates assertions against twin state and the call ledger, prints a PASS/FAIL table and exits 0/1.
5. **A tiny web UI** (`/`, one `static/index.html`, vanilla JS, light/dark): list envs, view ledger/state/egress, load a
   scenario, run the grader.

**Headline demo (mock mode):** the same agent *passes* `refund_happy_path`, *fails* `refund_flaky_network` (a dropped
response after the refund was applied makes the naive agent retry and refund twice), and *passes*
`refund_flaky_network_idempotent` (same fault, but the agent sends an `Idempotency-Key`).

### What it skips (on purpose)

Auth/accounts, billing, Docker images, the real product's DNS intercept mode, an MCP server, delivery of webhooks to real
URLs (egress is only recorded), Google Drive / Kalshi / other twins, daily fidelity checks against live APIs, and an
LLM-based grader (grading here is fully deterministic). See [FIDELITY.md](FIDELITY.md) for known gaps.

## Architecture

```
 scenario YAML ──► envs ──────► twins ───────────► control plane ───► agent ───────► grader
 (seed, clock,    in-memory     Stripe/Slack/       /_sim/*: clock,    tool-use loop   assertions over
  faults, asserts) registers,   GitHub REST          faults, ledger,    (Anthropic or   registers, ledger,
                   clock, rng,  shapes + errors      egress, snapshot   mock policy)    egress -> PASS/FAIL
                   ledger                                                               exit code 0 / 1
```

- `rehearsal/envs.py` - `Env` dataclass (registers, pinned clock + offset, id sequences, network profile, ledger, egress,
  snapshots) and the registry. `seed.py` validates + normalises seed data into vendor-shaped records (all-or-nothing).
- `rehearsal/faults.py` - one ASGI middleware wrapping every twin request: refuse (503, deterministic from `rng_seed`),
  rate-limit (429 + `Retry-After`), latency/jitter, drop-after-write, and ledger recording (`mutations` = registers touched).
- `rehearsal/twins/{stripe,slack,github}.py` - vendor-shaped routes, ids, error bodies and egress events.
- `rehearsal/control.py` - the `/_sim/*` routes. `scenarios.py` - YAML schema/loader/built-ins.
- `rehearsal/agent/` - `tools.py` (schemas + httpx executors), `mock_llm.py` (scripted policy with the same
  `messages.create` surface as the SDK), `support_agent.py` (the loop + CLI).
- `rehearsal/grade.py` - runner, assertion kinds `count | field | text_contains | calls | egress`, table/JSON output, CLI.

## Libraries and tools used

| Tool | Source | Used for |
|---|---|---|
| FastAPI | PyPI `fastapi` | server, routing, middleware |
| uvicorn | PyPI `uvicorn` | ASGI server (also run in a thread by tests and the grader CLI) |
| pydantic v2 | PyPI `pydantic` | scenario schema, network profile validation |
| PyYAML | PyPI `PyYAML` | scenario files |
| httpx | PyPI `httpx` | agent tool executors, test client, remote grading |
| pytest | PyPI `pytest` | test suite |
| stripe | PyPI `stripe` (github.com/stripe/stripe-python) | SDK-compatibility test against the Stripe twin |
| slack_sdk | PyPI `slack_sdk` (github.com/slackapi/python-slack-sdk) | SDK-compatibility test against the Slack twin |
| PyGithub | PyPI `PyGithub` (github.com/PyGithub/PyGithub) | SDK-compatibility test against the GitHub twin |
| anthropic 2.x (pinned `>=2,<3`, tested with 2.14.0) | PyPI `anthropic` (github.com/anthropics/anthropic-sdk-python) | the real-LLM agent path (`client.messages.create`) |

## Setup and run

Requires Python 3.11.

```bash
cd 2026-11-27-rystic
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # optional; the app reads real environment variables, so `export` them (see below)

# tests
.venv/bin/python -m pytest -q

# start the server (UI at http://localhost:8787/, API docs at /docs)
.venv/bin/uvicorn rehearsal.server:app --port 8787

# grade scenarios (boots its own in-process server; no need to start one)
REHEARSAL_MOCK=1 .venv/bin/python -m rehearsal.grade scenarios/refund_happy_path.yaml            # exit 0
REHEARSAL_MOCK=1 .venv/bin/python -m rehearsal.grade scenarios/refund_flaky_network.yaml          # exit 1 (2 refunds of $49, expected 1)
REHEARSAL_MOCK=1 .venv/bin/python -m rehearsal.grade scenarios/refund_flaky_network_idempotent.yaml  # exit 0
.venv/bin/python -m rehearsal.grade scenarios/refund_flaky_network.yaml --json --mock
.venv/bin/python -m rehearsal.grade scenarios/refund_happy_path.yaml --base http://localhost:8787     # use a running server

# end-to-end smoke test (starts a server, checks exit codes 0/1/0, stops it)
bash scripts/smoke.sh
```

Run the agent by hand against an env:

```bash
ENV=$(curl -s -XPOST localhost:8787/_sim/envs -H 'content-type: application/json' -d '{"scenario":"refund_happy_path"}' | python -c 'import sys,json;print(json.load(sys.stdin)["env_id"])')
.venv/bin/python -m rehearsal.agent.support_agent --base http://localhost:8787 --env $ENV --mock [--idempotency] [--task triage]
curl -s localhost:8787/_sim/envs/$ENV/calls
```

Point a real SDK at a twin:

```python
import stripe
client = stripe.StripeClient("sk_test_anything", base_addresses={"api": f"http://localhost:8787/e/{ENV}/stripe"})
client.v1.customers.create(params={"email": "dana@example.com"})

from slack_sdk import WebClient
WebClient(token="xoxb-anything", base_url=f"http://localhost:8787/e/{ENV}/slack/api/").chat_postMessage(channel="C0SUPPORT01", text="hi")

from github import Github, Auth
Github(auth=Auth.Token("ghp_anything"), base_url=f"http://localhost:8787/e/{ENV}/github").get_repo("acme/widgets")
```

Inject a fault:

```bash
curl -XPOST localhost:8787/_sim/envs/$ENV/network -H 'content-type: application/json' \
  -d '{"enabled": true, "latency_ms": 200, "drop_after_write": {"service": "stripe", "path_glob": "/v1/refunds", "count": 1}}'
```

## Environment variables

The app reads real process environment variables (it does not auto-load `.env`; `set -a; source .env; set +a` works).

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Optional. Absent -> deterministic mock agent. Never commit a real key. |
| `REHEARSAL_MODEL` | `claude-sonnet-5-5` | Model for the real-LLM path (`max_tokens=4096`; no `thinking`, no `temperature`). |
| `REHEARSAL_MOCK` | unset | Set to `1` to force the mock agent even if a key is present. |
| `REHEARSAL_PORT` | `8787` | Port used by `scripts/smoke.sh` and the agent CLI default base URL. |
| `REHEARSAL_PERSIST_DIR` | `.rehearsal` | Where snapshots are also written as JSON (gitignored). |

The real-LLM loop handles `stop_reason` `tool_use` (execute tools, continue), `end_turn` (done), `max_tokens` (stop, flagged
in `final_text`) and `refusal` (stop, flagged). It is unit-tested with a fake client; it has **not** been run against the live
Anthropic API in this build (no key available).

## Control-plane quick reference

`POST /_sim/envs` `{scenario?, seed?}` - `GET /_sim/envs` - `DELETE /_sim/envs/{id}` - `POST .../reset` (`{"to":"boot"}`) -
`POST .../seed` - `POST .../scenario` - `POST .../clock` (`{"time"}` or `{"advance_seconds"}`) - `GET|POST .../network` -
`GET .../inspect[?register=]` - `GET .../calls[?tail=]` - `GET .../egress[?tail=]` - `POST .../snapshot` - `POST .../restore` -
`GET /_sim/scenarios` - `GET /_sim/version` - `POST /_sim/grade` `{scenario, agent_flags}` - `GET /healthz`.

## Known limitations

- **No live fidelity checks.** Twins were written from public docs and never diffed against the real APIs. The real product
  runs these checks daily. Deliberate gaps are listed in [FIDELITY.md](FIDELITY.md).
- **Only 3 twins** (Stripe, Slack, GitHub), each a small subset of the real API.
- **In-memory state.** Restarting the server drops every env. Snapshots are written to `.rehearsal/` but restore reads memory.
- **`drop_after_write` returns an HTTP 500 with `Connection: close`** after applying the write; it does not sever the socket.
- **The double-refund demo uses no twin deviation**: the charge is $98 and the agent refunds the disputed $49, so a retried
  $49 refund is legitimately accepted (total 9800 <= 9800). The twin still rejects over-refunds (`charge_already_refunded`).
- Single-process, no auth, no concurrency hardening; the rate limiter uses wall-clock time.
- The mock agent is scripted; it demonstrates the harness, not LLM behaviour.

## Next 3 things to build

1. **Live fidelity checker:** a nightly job that replays a recorded call corpus against the real sandbox APIs and the twins,
   diffs response shapes, and fails CI on drift (the missing core of the real product).
2. **More twins + webhook delivery:** Google Drive and a Stripe-webhook/Slack-events egress that actually POSTs signed events
   to the agent's URL, with fault injection on delivery.
3. **Durable, parallel envs:** persist envs/snapshots (SQLite), a real connection-drop fault (raw socket close), an
   intercept proxy mode so unmodified agents need no base-URL changes, and a pytest plugin that gives each test its own env.
