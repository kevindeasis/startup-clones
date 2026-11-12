# BUILD_LOG — 2026-11-12 Pomerado clone ("Minter")

Running log of every model call in this run, for cost tracking. Prices fetched 2026-11-12 from https://platform.claude.com/docs/en/about-claude/pricing.

## Calls

| # | Model | Purpose | Tokens | Notes |
|---|-------|---------|--------|-------|
| 1 | Claude Sonnet (alias `sonnet`; assumed = Claude Sonnet 5.5, the newest Sonnet on the pricing page; the subagent transcript confirms `claude-sonnet-5-5`) | Full build: scaffold, browser layer, runner, two-level healing, mint pipeline (mock + real), MCP server (stdio + HTTP), demo site, tests, smoke script, README, verification | **126,385 total** (`subagent_tokens` from the Agent tool result; 25 tool uses, 772 s). The tool result does not split input/output, so the split below comes from de-duplicating the 25 `usage` records in the subagent transcript: **74,066 output**, **124,284 cache-write input**, **2,224,331 cache-read input**, ~50 uncached input. | Round 0 only. All SPEC §14 checks passed on its own run; no fix rounds were needed. |
| 0 | Claude Fable 5.1 (main agent) | Repo checks, web research (4 searches + ~14 fetches), SPEC.md, build prompt, independent review (build, tests, smoke), BUILD_LOG, doc page, architecture page, LinkedIn posts | Rough hand estimate: ~45 API turns over a context that grew from ~60k to ~270k tokens: **~9,000,000 cache-read input**, **~250,000 cache-write input**, **~40,000 output** | Not reported by any tool; counted by hand from the session. |

## Review rounds

- **Round 0 (Sonnet):** build complete. Subagent reported `npm run build` 0 errors, `npm test` 14/14, `npm run smoke` 21 PASS / exit 0, and every SPEC §14 check in mock mode.
- **Independent review (Fable):** read README, `runner.ts`, `heal.ts`, `mcp/server.ts`, `mint/index.ts`, `mint/explore-llm.ts`, `mint/generalise-llm.ts`, `config.ts`, the sample integration and `.gitignore`. Re-ran `npm run build` (clean), `npm test` (3 files, 14 passed, 41 s) and `npm run smoke` (21 PASS: demo site, mint, file shape, deterministic runs, auth with env secrets and missing-secret error, MCP stdio tools/list + tools/call + build_website_tool, HTTP dashboard + /mcp initialize + /api/run, self-heal on demo v2 with version bump and `heal:selectors` history, run log without input values). No leftover processes, no `data/` directory. Real mode (LLM explorer/generaliser) compiles but is untested because the sandbox has no API key. **Fix rounds: 0.**

## Estimated cost (estimate, not a bill)

Prices (per million tokens) from the pricing page fetched 2026-11-12:

| Model | Base input | 5m cache write | Cache read | Output |
|-------|-----------:|---------------:|-----------:|-------:|
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Fable 5.1 | $10 | $12.50 | $0.25 | $50 |

| Model | Role | Cache-write input | Cache-read input | Output | Est. cost |
|-------|------|------------------:|-----------------:|-------:|----------:|
| Claude Sonnet 5.5 | build (subagent) | 124,284 × $2.50 = $0.31 | 2,224,331 × $0.10 = $0.22 | 74,066 × $10 = $0.74 | **≈ $1.27** |
| Claude Fable 5.1 | research, review, docs (main agent) | ~250,000 × $12.50 = $3.13 | ~9,000,000 × $0.25 = $2.25 | ~40,000 × $50 = $2.00 | **≈ $7.40** |
| **Total** | | | | | **≈ $8.70** |

Caveats: the Sonnet figures come from the transcript's usage records (the Agent tool's own total was 126,385 tokens, which does not break out cache reads); the Fable figures are a hand estimate of a context that is mostly prompt-cache hits. Treat the total as a rough estimate.
