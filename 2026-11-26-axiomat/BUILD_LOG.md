# Build log — 2026-11-26 Axiomat clone ("Proven")

Pricing source (fetched 2026-11-26): https://platform.claude.com/docs/en/about-claude/pricing
- Claude Sonnet 5.5: $2 / MTok input, $2.50 / MTok 5-min cache write, $0.10 / MTok cache read, $10 / MTok output. The Agent tool's "sonnet" alias is assumed to resolve to the newest Sonnet listed there (Sonnet 5.5).
- Claude Fable 5.1 (main agent): $10 / MTok input, $12.50 / MTok 5-min cache write, $0.25 / MTok cache read, $50 / MTok output.
- Model IDs (https://platform.claude.com/docs/en/models/overview, fetched 2026-11-26): claude-fable-5-2, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5.

## Timeline

- Repo found at /home/user/startup-clones (branch main, pulled to 9486634). Identity set to deasis@ualberta.ca. `git push --dry-run origin main` → "Everything up-to-date" (push check passed).
- Listed 32 previous clone folders + 60 "YC Clone Pick" artifacts to exclude.
- Research: 2 web searches for F26 launches; fetched news.ycombinator.com/launches (reachable), roundfunded.com F26 list, extruct.ai F26 list (224 companies, two pages), thevccorner.com (paywalled); ycombinator.com/launches returned an empty page. 3 searches on shortlisted companies (Simulithic, Caveman, Axiomat); fetched ycombinator.com/companies/simulithic, ycombinator.com/companies/axiomat, axiomat.com, the Axiomat Launch YC post. Verified PyPI metadata for duckdb, sqlglot, fastapi, anthropic, uvicorn, pydantic, pyyaml, httpx.
- Pick: Axiomat (YC F26). Spec written to SPEC.md.
- Build delegated to a Sonnet subagent (prompt in BUILD_PROMPT.md, round 1). Returned after ~6 min: 28/28 pytest, smoke 5/5 in mock mode. It did not open a browser.
- Review by Fable (below). One focused fix round sent (round 2 in BUILD_PROMPT.md).

## Review by the main agent (Fable), after round 1

- Read README.md, app/verifier.py, app/compiler.py, app/pipeline.py, app/mock_llm.py, app/llm.py, app/main.py, app/db.py, scripts/smoke.sh, .gitignore, requirements.txt.
- Re-ran independently: `.venv/bin/python -m pytest -q` → 28 passed; `PROVEN_MOCK=1 PROVEN_DB_PATH=:memory: ./scripts/smoke.sh` → ALL SMOKE CHECKS PASSED (5/5).
- Booted `uvicorn app.main:app --port 8123` in mock mode and probed `/api/verify` by hand: a hand-written correct revenue query passes 7/7; `COUNT(*) FROM accounts` as `customers` fails (expression mismatch + missing predicates); `DELETE FROM accounts` fails `parses`; two stacked statements fail `parses`; `read_csv('/etc/passwd')` is rejected as a table function; the invoice_lines double-count query is rejected as forbidden. `/api/ask` "customers by plan in Canada" → proven, 3 rows, restatement includes the country filter.
- Playwright at 390×844 and 1280×900: scrollWidth == clientWidth (no horizontal scroll), zero console errors; clicked the revenue example (PROVEN badge, 7 green checks, 11-row table) and the "including trials" example (Attempt 1 failed `required_predicates_present`, Attempt 2 passed, result 43). Screenshots kept in the scratchpad only.
- Found 1: a raw query whose WHERE adds `accounts.account_id IN (SELECT account_id FROM invoice_lines)` passes verification for `customers`; the restatement cannot describe such a predicate, so it must be rejected (and nested SELECT/UNION should fail `parses`). → fix round 2.
- Found 2 (cosmetic): `month` values rendered as `2026-01-01T00:00:00`. → fix round 2 (cast to DATE).
- Not exercised: the real Anthropic path in app/llm.py (no ANTHROPIC_API_KEY in the sandbox); only the error path is unit-tested with a fake client.

## Re-verification after round 2 (Fable)

- `.venv/bin/python -m pytest -q` → 33 passed. `PROVEN_MOCK=1 PROVEN_DB_PATH=:memory: PORT=8124 ./scripts/smoke.sh` → ALL SMOKE CHECKS PASSED (5/5).
- Probes via FastAPI TestClient: the subquery query now fails `parses` ("nested SELECT ... or UNION is not allowed"); `accounts.name = 'Acme'` fails `required_predicates_present` ("unexplained WHERE predicate(s) the restatement cannot describe"); an `OR` predicate fails the same check; the four example questions re-asked are still proven, and month rows now read `2026-01-01`.
- `git status --short -uall` shows no `.duckdb`, `.venv`, `__pycache__` or `.env` files. No server left running.

## Subagent calls

| # | Model | Purpose | Tokens (reported) | Result |
|---|-------|---------|-------------------|--------|
| 1 | sonnet (assumed Claude Sonnet 5.5) | Full build of the clone per SPEC.md, verification, README | Agent tool `subagent_tokens`: **94,905** (16 API calls, 15 tool uses, 5.8 min) | 28/28 pytest, smoke 5/5 |
| 2 | sonnet (same agent, resumed) | Fix round: reject nested SELECT/UNION and unexplained WHERE predicates; month as DATE; 5 new tests | Agent tool `subagent_tokens` after the round: **101,680** cumulative (+6,775; 21 API calls total) | 33/33 pytest, smoke 5/5 |

Transcript usage for both rounds, deduplicated by message id (21 API calls): output **53,871**; cache writes **100,718**; cache reads **1,528,905**; uncached input **44**. (The `subagent_tokens` figure counts only input + output, not cache traffic; the transcript figures are used for the estimate.)

Fix rounds requested by the reviewer (Fable): **1** (of the 2 allowed). No application code was written by the main agent.

## Main agent (Fable) work, rough count

Research (5 web searches + 10 fetches), spec, prompt assembly, review (code reading, pytest, smoke, hand probes, Playwright at phone and desktop width), commit, doc page, architecture page, LinkedIn posts. Estimated from context growth: ≈ 65,000 output tokens; ≈ 250,000 cache-write input tokens; ≈ 3,000,000 cache-read input tokens.

## Estimated cost (ESTIMATE — prices fetched 2026-11-26 from https://platform.claude.com/docs/en/about-claude/pricing)

Assumption: the Agent tool's "sonnet" alias resolves to the newest Sonnet listed, **Claude Sonnet 5.5** ($2 / MTok input, $2.50 / MTok 5-minute cache write, $0.10 / MTok cache read, $10 / MTok output). Main agent: **Claude Fable 5.1** ($10 / MTok input, $12.50 / MTok 5-minute cache write, $0.25 / MTok cache read, $50 / MTok output).

| Bucket | Model | Tokens | Price used | Est. cost |
|---|---|---|---|---|
| Build (Sonnet subagent, 2 rounds) | Sonnet 5.5 | 53,871 output | $10 / MTok | $0.54 |
| | | 100,718 cache-write input | $2.50 / MTok | $0.25 |
| | | 1,528,905 cache-read input | $0.10 / MTok | $0.15 |
| | | 44 uncached input | $2 / MTok | $0.00 |
| **Build subtotal** | | | | **≈ $0.94** |
| Research, review, docs (Fable) | Fable 5.1 | ≈ 65,000 output | $50 / MTok | $3.25 |
| | | ≈ 250,000 cache-write input | $12.50 / MTok | $3.13 |
| | | ≈ 3,000,000 cache-read input | $0.25 / MTok | $0.75 |
| **Fable subtotal** | | | | **≈ $7.13** |
| **Total** | | | | **≈ $8.07** |

Web search surcharges, if any, are not included. Sonnet figures come from the subagent transcript; Fable figures are a rough estimate.
