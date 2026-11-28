# Build log — 2026-11-28 Mirrors clone ("Steer")

Pricing source (fetched 2026-11-28): https://platform.claude.com/docs/en/about-claude/pricing
- Claude Sonnet 5.5: $2 / MTok input, $2.50 / MTok 5-min cache write, $0.10 / MTok cache read, $10 / MTok output. The Agent tool's "sonnet" alias is assumed to resolve to the newest Sonnet listed there (Sonnet 5.5).
- Claude Fable 5.1 (main agent): $10 / MTok input, $12.50 / MTok 5-min cache write, $0.25 / MTok cache read, $50 / MTok output.
- Model IDs in use: claude-sonnet-5-5 (clone default).

## Timeline

- Repo found at /home/user/startup-clones (branch main, fast-forwarded 7d707e8..55d4468). Identity set to deasis@ualberta.ca. `git push --dry-run origin main` → "Everything up-to-date" (push check passed).
- Listed 34 previous clone folders + 60 most recent artifacts ("YC Clone Pick — ...") to exclude.
- Research: 3 web searches (F26 launches, batch lists); fetched news.ycombinator.com/launches (page 1 reachable, page 2 and ycombinator.com/launches returned empty shells), startups.fru.dev F26 list (100 of 240), lemstudio.co F26 list (198). Shortlisted Agent Relay (already open source → skipped), Papaya (PR-opening optimizer, broader), Mirrors, Plek (PE workforce taxonomy → heavy data), Definite (W27, ERP integrations), GodHands (screen-watching → skipped). Fetched YC company pages for all six.
- Pick: Mirrors (YC F26) — scoped, measured, real-time corrections for production agents. Fetched mirrors.dev, the YC launch post, docs/agents.md, docs/guides/corrections.md, docs/guides/runtime-modes.md, docs/sdk/python-reference.md for SDK semantics (get_context / capture_trace, off/shadow/active modes, fail-open budget).
- Verified on PyPI (2026-11-28): fastapi 0.165.0, uvicorn 0.54.0, anthropic 2.14.0, pydantic 2.14.4, pytest 9.2.0, httpx 0.29.0. Python 3.11.18 in the sandbox.
- Spec written to SPEC.md ("Steer": capture → discover → correct → preview → activate with holdout → measure, plus a scripted demo agent).
- No Docs connector attached to the session (ListConnectors returned nothing), so the shared doc is published as an Artifact page.
- Build delegated to a Sonnet subagent (verbatim prompt in BUILD_PROMPT.md, round 1). The Agent tool returned the agent in the background; its hand-back arrived after 8.4 min.
- Round 1 returned: 40/40 pytest; self-contained demo exit 0 (baseline 18%, 2 mistakes found, preview 40 turns / 20 conversations / 33 exclusions, treatment 12/12 vs holdout 0/16); demo against a separately started uvicorn also exit 0; `/healthz`, `/` and the five dashboard endpoints returned 200. Agent tool `subagent_tokens`: **117,112** (13 tool uses, 505.9 s). Transcript usage, deduplicated by message id (13 API calls, all `claude-sonnet-5-5`): output 69,824; cache writes 115,584; cache reads 1,033,695; uncached input 25.

## Review by the main agent (Fable), after round 1

- Read README.md, .gitignore, requirements.txt, .env.example, steer_sdk/__init__.py, steer/server.py, triggers.py, holdout.py, report.py, llm.py, discovery.py, examples/support_agent.py, examples/demo.py, steer/static/index.html (about 2,200 lines in total).
- Re-ran independently: `.venv/bin/python -m pytest -q` → **40 passed** (3 starlette TestClient `timeout` deprecation warnings). `STEER_MOCK=1 python -m examples.demo --serve --port 0` → exit 0 in 16.1 s: baseline 18% over 40 conversations; discovery found "Re-offers retention discount after the customer already declined" (20 turns) and "Restarts troubleshooting the customer already completed" (13 turns); preview matched 40 turns in 20 conversations with 33 near-miss exclusions and 0 conflicts; after activation at 50% holdout, treatment 18/18 (100%) vs holdout 0/13 (0%), lift 100%, still repeating 0 vs 13.
- Booted `uvicorn steer.server:app --port 8790` with a scratch `STEER_DB`: `/healthz` → 200 `{"ok":true,"mock":true}`, `/` → 200, `/v1/agents` without the key → 401. Ran `python -m examples.demo --api-url http://localhost:8790` → exit 0 (treatment 15/15 vs holdout 0/16). `GET /v1/agents/{id}/mistakes` returned the two mistakes with their suggested triggers; `GET /v1/corrections/{id}/report` returned the same numbers as the demo.
- Playwright (headless Chromium) at 390×844 and 1280×900, light and dark: scrollWidth == clientWidth on every view (no horizontal scroll), zero console errors or page errors; Turns view lists 60 turns and a turn review expands to 11 messages with tool calls; Mistakes view lists the 2 mistakes; Corrections view lists the 1 active correction (pills `active`, `v1`, `holdout 50%`); opening it renders the stored preview ("Would reach 40 turns in 20 conversations of 113 scanned; 33 near misses; 0 conflicts") and the report with two bars (Treatment 100% 15/15, Holdout 0% 0/16, Lift 100 pts); clicking Preview re-runs it over the now 262 stored turns. Dark theme: body background and text come from the dark token set; bars render.
- Spec deviations noted by the subagent and accepted: `still_repeating` is returned as a total plus a `still_repeating_by_group` object (the demo uses the per-group counts); activating a correction does not flip the agent mode (the demo does it explicitly and the dashboard offers to); ingestion is synchronous although the capture response says `queued`.
- Not exercised: the real Anthropic path (no `ANTHROPIC_API_KEY` in the sandbox); it is covered only by fake-client unit tests (fenced-JSON parsing, classifier yes/no, timeout → fail closed, refusal → heuristics fallback).
- Verdict: acceptance checks 1–5 in SPEC.md pass. **No fix round requested** (0 of the 2 allowed). No application code was written by the main agent. Stopped the uvicorn process and removed the scratch `.steer/` directory; `git status --short --ignored` shows only `.venv`, `__pycache__` and `.pytest_cache` as ignored, no `.env` or `*.db`.

## Subagent calls

| # | Model | Purpose | Tokens (reported) | Result |
|---|-------|---------|-------------------|--------|
| 1 | sonnet (assumed Claude Sonnet 5.5) | Full build of the clone per SPEC.md, verification, README | Agent tool `subagent_tokens`: **117,112** (13 API calls, 13 tool uses, 8.4 min) | 40/40 pytest, demo exit 0 twice |

Transcript usage for round 1, deduplicated by message id (13 API calls): output **69,824**; cache writes **115,584**; cache reads **1,033,695**; uncached input **25**. (The `subagent_tokens` figure counts input + output only, not cache traffic; the transcript figures are used for the estimate.)

Fix rounds requested by the reviewer (Fable): **0** (of the 2 allowed).

## Main agent (Fable) work, rough count

Research (3 web searches, 17 page fetches), SPEC.md (≈ 4,500 words), the subagent prompt, review (reading ≈ 2,200 lines of code, running tests/demo/server/Playwright), BUILD_LOG.md, the shared doc with three LinkedIn posts, and the architecture page. The harness does not report the main agent's token usage, so this is an estimate from the size of the material written and read: output ≈ **60,000** tokens; prompt-cache writes ≈ **150,000**; cache reads ≈ **3,000,000**; uncached input negligible.

## Estimated cost (estimate, not a bill)

Prices fetched 2026-11-28 from https://platform.claude.com/docs/en/about-claude/pricing. Assumption: the Agent tool's "sonnet" alias resolves to the newest Sonnet listed, **Claude Sonnet 5.5** ($2 / MTok input, $2.50 / MTok 5-minute cache write, $0.10 / MTok cache read, $10 / MTok output). Main agent: **Claude Fable 5.1** ($10 / MTok input, $12.50 / MTok 5-minute cache write, $0.25 / MTok cache read, $50 / MTok output).

| Bucket | Model | Tokens | Price | Cost |
|---|---|---|---|---|
| Build (Sonnet subagent) | Sonnet 5.5 | 69,824 output | $10 / MTok | $0.70 |
| Build (Sonnet subagent) | Sonnet 5.5 | 115,584 cache writes | $2.50 / MTok | $0.29 |
| Build (Sonnet subagent) | Sonnet 5.5 | 1,033,695 cache reads | $0.10 / MTok | $0.10 |
| Build (Sonnet subagent) | Sonnet 5.5 | 25 uncached input | $2 / MTok | $0.00 |
| **Build subtotal** | | | | **≈ $1.09** |
| Research, review, docs (Fable) | Fable 5.1 | ≈ 60,000 output | $50 / MTok | $3.00 |
| Research, review, docs (Fable) | Fable 5.1 | ≈ 150,000 cache writes | $12.50 / MTok | $1.88 |
| Research, review, docs (Fable) | Fable 5.1 | ≈ 3,000,000 cache reads | $0.25 / MTok | $0.75 |
| **Fable subtotal** | | | | **≈ $5.63** |
| **Total** | | | | **≈ $6.70** |

The Sonnet figures are measured from the subagent transcript; the Fable figures are a rough estimate. Web search calls are billed separately by the harness and are not included.
