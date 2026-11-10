# Build log

## Pick
Collar AI (YC F26). Skipped Lightfield (= already-cloned Neomatter), herdr (native terminal app, not LLM layer).

## Calls
| # | Model | Purpose | Tokens |
|---|-------|---------|--------|
| 1 | sonnet (alias -> Claude Sonnet 5.5) | Build irdesk clone, tests, README | 75,952 total (input/output split not reported), 14 tool uses, ~230 s |

Fix rounds: 0. Fable review: ran pytest (14 passed) and booted the app in mock mode; /health, demo load, /api/qa (cited 18.4% answer) and /api/desk refusal on non-public doc all OK. Real-LLM path not exercised (no API key).

## Fable (main agent) work — rough estimate, exact counters not visible
~60k fresh input, ~190k cached input, ~12k output (research, spec, review, doc, page, posts).

## Cost estimate (prices from https://platform.claude.com/docs/en/about-claude/pricing, fetched 2026-11-10)
- Sonnet 5.5: $2/MTok in, $10/MTok out. 75,952 tokens, assumed 80/20 in/out split: 60.8k*$2 + 15.2k*$10 = ~$0.27 (range $0.15 all-input to $0.76 all-output).
- Fable 5.2: $8/MTok in, $0.20 cached, $40/MTok out: 60k*8 + 190k*0.2 + 12k*40 = $0.48+$0.04+$0.48 = ~$1.00.
- Total ~ $1.27 (estimate).
