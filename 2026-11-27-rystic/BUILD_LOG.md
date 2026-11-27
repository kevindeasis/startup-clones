# Build log — 2026-11-27 Rystic clone

Pricing source (fetched 2026-11-27): https://platform.claude.com/docs/en/about-claude/pricing
- Claude Sonnet 5.5: $2 / MTok input, $2.50 / MTok 5-min cache write, $0.10 / MTok cache read, $10 / MTok output. The Agent tool's "sonnet" alias is assumed to resolve to the newest Sonnet listed there (Sonnet 5.5).
- Claude Fable 5.1 (main agent): $10 / MTok input, $12.50 / MTok 5-min cache write, $0.25 / MTok cache read, $50 / MTok output.
- Model IDs in use: claude-sonnet-5-5 (clone default), claude-opus-5-5, claude-haiku-5-5, claude-fable-5-2.

## Timeline

- Repo found at /home/user/startup-clones (branch main, fast-forwarded to b9f2553). Identity set to deasis@ualberta.ca. `git push --dry-run origin main` → "Everything up-to-date" (push check passed).
- Listed 33 previous clone folders + 67 artifacts ("YC Clone Pick — ...") to exclude.
- Research: 3 web searches for F26 launches; fetched news.ycombinator.com/launches (2 pages, reachable), extruct.ai F26 list (224 companies), lemstudio.co F26 list (198), startups.fru.dev F26 (100 of 240); ycombinator.com/companies?batch=... returned an empty shell. Shortlisted Caveman, Rystic, Hickory, Tire Swing, Gather; fetched their YC pages (Hickory slug 404, Gather slug resolved to the S20 company). Caveman's product is cloud agent infra plus an already open-source skill → skipped. Tire Swing is W25 and document-heavy → skipped.
- Pick: Rystic (YC F26) — stateful local simulators of Slack / Stripe / GitHub for testing agents.
- Verified on PyPI (2026-11-27): fastapi 0.165.0, uvicorn 0.54.0, stripe 17.1.0, slack_sdk 3.48.0, PyGithub 2.10.0, pydantic 2.14.4, pyyaml 6.0.4, httpx 0.29.0, pytest 9.2.0, anthropic 2.14.0. Fetched rystic.ai, rystic.ai/docs, rystic.ai/llms-full.txt (first 100k chars), fondo.com launch coverage, the YC company page (launch post slug WZ9-…).
- Spec written to SPEC.md ("Rehearsal": Stripe/Slack/GitHub twins + control plane + mock-able support agent + deterministic grader + flaky-network demo).
- Build delegated to a Sonnet subagent (verbatim prompt in BUILD_PROMPT.md, round 1).
- Round 1 returned after 10.7 min: 57/57 pytest, smoke 0/1/0, real stripe / slack_sdk / PyGithub SDKs pass against the twins. Agent tool `subagent_tokens`: 151,567 (25 tool uses). Transcript usage, deduplicated by message id (24 API calls): output 98,238; cache writes 149,574; cache reads 2,541,820; uncached input 46.

## Review by the main agent (Fable), after round 1

- Read README.md, FIDELITY.md, requirements.txt, .gitignore, rehearsal/agent/support_agent.py, mock_llm.py, tools.py, faults.py, twins/stripe.py (first 200 lines), grade.py (first 150 lines), the three refund scenarios.
- Re-ran independently: `.venv/bin/python -m pytest -q` → 57 passed; `REHEARSAL_MOCK=1 bash scripts/smoke.sh` → ALL SMOKE CHECKS PASSED (exit codes 0/1/0); no uvicorn left running.
- Booted `uvicorn rehearsal.server:app --port 8791`; `/healthz` 200. Playwright at 390×844 and 1280×900: scrollWidth == clientWidth (no horizontal scroll), zero console errors, 7 UI controls present. Screenshots kept in the scratchpad only.
- Found 1 (important): the double-refund demo depended on a twin option `stripe_allow_duplicate_refunds` (real Stripe rejects a second full refund). A partial-refund scenario ($98 charge, "refund the duplicate $49") shows the same bug with no fidelity deviation. → fix round 2.
- Found 2: `requirements.txt` pinned `anthropic>=0.40,<1` (installed 0.125.0); the current SDK line is 2.x (2.14.0 on PyPI). → fix round 2.
- Not exercised: the real Anthropic path (no ANTHROPIC_API_KEY in the sandbox); only fake-client unit tests cover it.

## Re-verification after round 2 (Fable)

- Round 2 (same agent, resumed) returned after 1.1 min and 5 tool uses. Agent tool `subagent_tokens` after the round: **163,608** cumulative (+12,041).
- `.venv/bin/python -m pytest -q` → 59 passed. `REHEARSAL_MOCK=1 bash scripts/smoke.sh` → ALL SMOKE CHECKS PASSED (0/1/0).
- `python -m rehearsal.grade scenarios/refund_flaky_network.yaml` → exit 1; ledger shows `stripe_create_refund` ERROR HTTP 500 then a retried `stripe_create_refund` ok; FAIL rows: `count stripe.refunds == 1` actual 2, `amount_refunded == 4900` actual 9800, `count stripe.refunds{amount=4900} == 1` actual 2, `calls POST /v1/refunds <= 1` actual 2. No twin deviation needed (two partial $49 refunds on a $98 charge are legal in Stripe).
- `stripe_allow_duplicate_refunds` no longer appears in code, scenarios, README or FIDELITY.md. `pip show anthropic` → 2.14.0. No uvicorn left running. `git status --short --ignored` shows only the untracked folder; `.venv`, `.pytest_cache`, `__pycache__` ignored; no `.env` or `.rehearsal/`.

## Subagent calls

| # | Model | Purpose | Tokens (reported) | Result |
|---|-------|---------|-------------------|--------|
| 1 | sonnet (assumed Claude Sonnet 5.5) | Full build of the clone per SPEC.md, verification, README, FIDELITY.md | Agent tool `subagent_tokens`: **151,567** (24 API calls, 25 tool uses, 10.7 min) | 57/57 pytest, smoke 0/1/0 |
| 2 | sonnet (same agent, resumed) | Fix round: faithful partial-refund demo (remove twin option), anthropic SDK pin to 2.x, tests + docs | `subagent_tokens` after the round: **163,608** cumulative (+12,041; 31 API calls total, 1.1 min) | 59/59 pytest, smoke 0/1/0 |

Transcript usage for both rounds, deduplicated by message id (31 API calls): output **106,105**; cache writes **162,372**; cache reads **3,633,989**; uncached input **63**. (The `subagent_tokens` figure counts input + output only, not cache traffic; the transcript figures are used for the estimate.)

Fix rounds requested by the reviewer (Fable): **1** (of the 2 allowed). No application code was written by the main agent.

## Main agent (Fable) work, rough count

Research (6 web searches + 14 fetches), spec, prompt assembly, review (code reading, pytest, smoke, grader runs, Playwright at phone and desktop width), fix request, commit/push, doc page, architecture page, LinkedIn posts. Estimated from context growth (~270k tokens of context by the end of the review, ~50 turns): ≈ 55,000 output tokens; ≈ 280,000 cache-write input tokens; ≈ 6,000,000 cache-read input tokens.

## Estimated cost (ESTIMATE — prices fetched 2026-11-27 from https://platform.claude.com/docs/en/about-claude/pricing)

Assumption: the Agent tool's "sonnet" alias resolves to the newest Sonnet listed, **Claude Sonnet 5.5** ($2 / MTok input, $2.50 / MTok 5-minute cache write, $0.10 / MTok cache read, $10 / MTok output). Main agent: **Claude Fable 5.1** ($10 / MTok input, $12.50 / MTok 5-minute cache write, $0.25 / MTok cache read, $50 / MTok output).

| Bucket | Model | Tokens | Price used | Est. cost |
|---|---|---|---|---|
| Build (Sonnet subagent, 2 rounds) | Sonnet 5.5 | 106,105 output | $10 / MTok | $1.06 |
| | | 162,372 cache-write input | $2.50 / MTok | $0.41 |
| | | 3,633,989 cache-read input | $0.10 / MTok | $0.36 |
| | | 63 uncached input | $2 / MTok | $0.00 |
| **Build subtotal** | | | | **≈ $1.83** |
| Research, review, docs (Fable) | Fable 5.1 | ≈ 55,000 output | $50 / MTok | $2.75 |
| | | ≈ 280,000 cache-write input | $12.50 / MTok | $3.50 |
| | | ≈ 6,000,000 cache-read input | $0.25 / MTok | $1.50 |
| **Research/review/docs subtotal** | | | | **≈ $7.75** |
| **Total** | | | | **≈ $9.60** |

Web search tool calls (6) are not included; at $10 per 1,000 searches they add about $0.06 if billed.
