# Build log — Poth Labs clone (2026-11-09)

## Subagent calls
| # | Model | Purpose | Tokens |
|---|-------|---------|--------|
| 1 | sonnet (alias -> Claude Sonnet 5.5) | Build clone per SPEC.md | 78,598 total (`subagent_tokens`; no input/output split reported) |

Fix rounds: 0.

## Review (Fable)
- Re-ran `npm ci`, `npm test` (6 pass), `npm run build` (ok); booted `next start` with no API key, loaded sample data (12 accounts, 26 evidence) and generated 5 hypotheses with evidence ids. Not checked in a browser; real-LLM path untested.

## Cost estimate (ESTIMATE)
Prices from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-11-09): Sonnet 5.5 $2 in / $10 out per MTok; Fable 5.1 $10 in / $50 out per MTok. "sonnet" assumed to resolve to Sonnet 5.5.

| Part | Input tok | Output tok | Cost |
|------|-----------|------------|------|
| Build (Sonnet subagent) — 78,598 total, assumed 85/15 split | ~66,800 | ~11,800 | 0.134 + 0.118 = ~$0.25 |
| Research, review, docs (Fable) — rough guess, uncached | ~250,000 | ~25,000 | 2.50 + 1.25 = ~$3.75 |
| **Total** | | | **~$4.00** |

Fable figures are a rough count of this session's own work (I cannot read exact usage); the Sonnet split is an assumption. Docs/artifact writing is included in the Fable guess.
