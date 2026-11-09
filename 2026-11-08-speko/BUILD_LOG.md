# BUILD_LOG — Speko clone (2026-11-08)

Pick: Speko (YC S26). Research via web search (YC/HN directory hosts were not reachable from the sandbox; PyPI and the pricing page were). Libraries verified on PyPI: litellm 1.108.3, jiwer 4.0.0, fastapi 0.162.2.

| # | Model | Purpose | Tokens |
|---|---|---|---|
| 1 | claude-sonnet-5-5 (`sonnet` alias, Agent tool) | Full build from SPEC.md | ~68,800 (est.) | ~17,200 (est.) | Harness `subagent_tokens: 85,964` total, 14 tool uses, ~307 s. Subagent could not report its own split; 80/20 assumed. |

## Review (Fable, main agent)
- Re-ran `pytest -q` (13 passed), `bash scripts/smoke.sh` (SMOKE PASS); booted uvicorn in mock mode and hit `/api/route` (hi/quality -> mock-stt-beta) and `/api/turn` (3-stage trace) manually.
- Verdict: acceptance checks A1–A7 met; no fix round. **Fix rounds: 0.**
- Not exercised: real litellm adapters (no API keys); browser UI not screenshot-tested (API verified only).

## Estimated cost (ESTIMATE — not a bill)
Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-11-08): Claude Sonnet 5.5 $2 in / $10 out per MTok (the `sonnet` alias assumed to be the newest Sonnet listed); Claude Fable 5.1 $10 in / $50 out per MTok, cache reads $0.25.

| Role | Model | Input | Output | Price | Est. cost |
|---|---|---|---|---|---|
| Build (Sonnet subagent) | Sonnet 5.5 | ~68,800 | ~17,200 | $2 / $10 | **≈ $0.31** |
| Research, spec, review, docs, posts, page (main agent) | Fable 5.1 | ~1.2M cumulative context (mostly cache reads) + ~30k fresh | ~25,000 | $10 / $50; cache reads $0.25 | **≈ $2.0** |
| **Total** | | | | | **≈ $2.3 (estimate)** |

Main-agent numbers are a rough count (no usage tool available); the Sonnet split is assumed 80/20.
