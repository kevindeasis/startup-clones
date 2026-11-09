# BUILD_LOG.md — Latent clone, 2026-11-06

Running log of every model call in this run. Token counts for the subagent are the numbers it reported back; counts for the main agent (Fable) are approximate.

| # | Model | Purpose | Input tokens | Output tokens | Notes |
|---|-------|---------|-------------:|--------------:|-------|
| 0 | claude-fable-5-1 (main agent) | Step 1–2: repo clone, prior-pick check, web research (6 searches, 8 fetches), pick, SPEC.md, build prompt | ~95,000 (cumulative context incl. tool results) | ~9,000 | Research + spec writing before the build started |
| 1 | Sonnet via Agent tool alias "sonnet" (assumed claude-sonnet-5-5, the current Sonnet) (subagent, via Agent tool) | Round 0: full build + self-verification | ~54,000 (est.) | ~27,000 (est.) | Harness reported `subagent_tokens: 80763`, 8 tool uses, 207 s. Subagent's own estimate was 45k in / 22k out; split here scaled to the harness total using its ~2:1 ratio. 22 tests passing, all 9 acceptance checks reported passing in mock mode. |
| 2 | claude-fable-5-1 (main agent) | Step 3 review: read judge.py, main.py, SDK; re-ran `pytest -q` (22 passed); booted uvicorn; ran acceptance checks 3–8 + escalate/chat/calibrate by hand; Playwright screenshots at 1200px light and 390px dark (no console errors, no horizontal scroll) | ~30,000 | ~3,000 | All checks passed on first review. **Fix rounds needed: 0.** |
| 3 | claude-fable-5-1 (main agent) | Post-review touch-up by the main agent (no subagent round): bumped default model IDs from `claude-sonnet-4-5`/`claude-haiku-4-5` to the current `claude-sonnet-5-5`/`claude-haiku-5-5` in config.py, .env.example, README.md and SPEC.md (BUILD_PROMPT.md kept verbatim as sent); re-ran pytest | ~5,000 | ~1,000 | Model IDs verified on platform.claude.com/docs models overview |

## Estimated cost (see doc / architecture page for the table)

Prices looked up 2026-11-06 on platform.claude.com/docs/en/about-claude/pricing: Fable 5.1 $10 in / $50 out per 1M tokens; Sonnet 5.5 $2 in / $10 out per 1M tokens. Cache discounts ignored (conservative). Fix rounds: 0.
