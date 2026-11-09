# BUILD_LOG.md — run log for 2026-10-25 Asakana clone

Run started 2026-10-25 ~05:00 UTC (scheduled task, unattended).

## Pre-build (Fable, main agent)
- add_repo tool was not available in this session; `git push --dry-run` was refused by the git proxy (repo not in the session's authorized set). Build continues; push attempted again at the end.
- Repo had no previous `YYYY-MM-DD-*` folders; no prior "YC Clone Pick" artifacts.
- Research: ~9 web searches / fetches (YC F26 directory, HN launches, Asakana YC profile and website, PyPI checks for 11 libraries, htmx repo).
- Wrote SPEC.md (~2,100 words) and BUILD_PROMPT.md.

## Subagent calls
### Round 0 — initial build
- Model: Sonnet (Agent tool, subagent_type general-purpose, model "sonnet"; the alias resolved to the current Sonnet — assumed Sonnet 5.5 for pricing).
- Purpose: build OrderDesk end to end per SPEC.md, verify in mock mode, write README.
- Harness-reported usage: 123,860 tokens total, 18 tool uses, 479 s wall time. The subagent's own rough estimate was ~120k input / ~35k output; the harness total is used for costing, split ≈ 77% input / 23% output (≈ 95k in / 29k out).
- Result: 36 files; `python -m app.seed` → products=40 customers=3 erp_orders=9 samples=5; `pytest -q` → 18 passed; uvicorn booted and all acceptance routes returned 200.

## Review (Fable, main agent)
- Read README.md, app/llm.py, app/pipeline.py, app/matching.py, .gitignore, .env.example, requirements.txt.
- Re-ran from scratch: `python -m app.seed`, `pytest -q` (18 passed in 1.51s), `uvicorn app.main:app --port 8011`.
- Exercised the main flow with curl: POST /intake (SMS sample, customer 1) → 303 /orders/1 with 3 lines (HAMACHI-LOIN 1.0, SALMON-FIL-ATL 0.95, OYSTER-KUM 0.85 from history SO-1008); HTMX line edit to OYSTER-KUS; POST /orders/1/approve → SO-1010 in /erp/orders.csv; rep summary rendered at /summaries; second identical intake resolved the history line to the corrected SKU; photo and .eml uploads → 303; Playwright screenshots of /orders/1 and / looked correct.
- Verdict: all acceptance checks pass. **Fix rounds needed: 0.**

## Cost estimate (see the shared doc for the table)
- Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-25): Fable 5.1 $10 in / $0.25 cache read / $50 out per MTok; Sonnet 5.5 $2 in / $10 out per MTok.
- Build (Sonnet subagent): ≈95k in × $2 + ≈29k out × $10 ≈ **$0.48** (≈$0.71 if the alias resolved to Sonnet 4.6 pricing).
- Research, review, docs (Fable): no per-call usage tool was available; estimated from the session's token counter (~200k new context tokens over ~45 turns) as ≈150k uncached input × $10 + ≈4M cached-context reads × $0.25 + ≈40k output × $50 ≈ **$4.50**.
- Total ≈ **$5** (estimate).
