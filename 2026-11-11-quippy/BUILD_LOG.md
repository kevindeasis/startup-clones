# BUILD_LOG — 2026-11-11 Quippy clone

Running log of every model call in this run, for cost tracking.

## Calls

| # | Model | Purpose | Tokens | Notes |
|---|-------|---------|--------|-------|
| 1 | Claude Sonnet (alias `sonnet`, assumed = Claude Sonnet 5.5, the newest Sonnet on the pricing page) | Full build: scaffold, lib/llm, API routes, pages, components, tests, README, verification | **108,038 total** (`subagent_tokens` from the Agent tool result; 26 tool uses, 509 s). The result does not split input/output, so the cost table assumes a 90/10 split: ~97,200 input / ~10,800 output. | Round 0 only. Passed all acceptance checks on its own run; no fix rounds were needed. |
| 0 | Claude Fable 5.1 (main agent) | Repo checks, web research (≈12 searches/fetches), SPEC.md, prompt, independent review (build, tests, curl flow), doc, architecture page, LinkedIn posts | Rough estimate: ~450,000 input (mostly prompt-cache hits re-reading a growing context) / ~25,000 output | Counted by hand from the session; not reported by any tool. |

## Review rounds

- **Round 0 (Sonnet):** build complete. Subagent reported `npm test` 18/18, `npm run build` OK, lint 0 problems, and all SPEC §10 checks in mock mode.
- **Independent review (Fable):** re-ran `npm test` (18 passed) and `npm run build` (all 13 routes compiled), booted `LLM_MOCK=1 npm run start` on port 3177 with a scratch `DB_PATH`, and drove the flow with curl: home 200 with all 8 scenario titles + "Mock LLM" badge; session create; opening line + 3 partner replies streamed as `text-delta` chunks; feedback → score 65, pattern `over-apologising`, one entry per user line; progress → `s1-opener` completed, streak 1, pattern count 1; drill attempt → `landed`, done; custom scenario created and shown on home; `/progress` and feedback page 200. Server stopped, scratch DB removed, no `data/` dir left. **Fix rounds: 0.**

## Estimated cost (estimate, not a bill)

Prices fetched 2026-11-11 from https://platform.claude.com/docs/en/about-claude/pricing (base input / output per million tokens, no cache discount applied):

| Model | Role | Input tokens | Output tokens | Price in / out ($/MTok) | Est. cost |
|-------|------|-------------:|--------------:|-------------------------|----------:|
| Claude Sonnet 5.5 | build (subagent) | ~97,200 | ~10,800 | $2 / $10 | **≈ $0.30** |
| Claude Fable 5.1 | research, review, docs (main agent) | ~450,000 | ~25,000 | $10 / $50 | **≈ $5.75** |
| **Total** | | | | | **≈ $6.05** |

Caveats: the Sonnet input/output split is assumed; the Fable counts are a hand estimate; most Fable input was served from the prompt cache ($0.25/MTok for hits), so the real Fable figure is likely well under the number above. Treat the total as an upper-bound estimate.
