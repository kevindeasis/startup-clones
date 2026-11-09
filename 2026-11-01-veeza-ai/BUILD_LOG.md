# BUILD_LOG.md — subagent calls and cost tracking

Run date: 2026-11-01 (UTC). Main agent: Claude Fable 5.1 (`claude-fable-5-1`) — research, spec, review, docs, posts. Build subagent: Claude Sonnet (Agent tool, model "sonnet").

| # | Model | Purpose | Input tokens | Output tokens | Notes |
|---|---|---|---|---|---|
| 1 | sonnet (Agent tool, general-purpose) | Round 1 — full build from SPEC.md, verification, README | see note | see note | Agent tool reported `subagent_tokens: 107158` total (input+output combined; the tool does not split them), 25 tool uses, 431 s. Subagent could not see its own usage. Result: all 9 acceptance checks reported PASS; libsql driver worked, no fallback needed. |

## Review by main agent (Fable)

- Re-ran `npm run build` (exit 0, 15 routes) and `MOCK_LLM=1 npm start` + `scripts/smoke.sh`: all 6 smoke checks PASS (checks 2–7 of SPEC.md; check 1 = build, check 9 = gitignore verified manually).
- Drove the UI with Playwright: landing, new application, passport upload (fields extracted in mock mode), document upload (verdict badge + extracted data), readiness tab (score, narrative, top fixes, rule results), review tab. No console or page errors.
- Read `src/lib/llm.ts`, `scoring.ts`, `README.md`: real-LLM path uses `generateObject`/`generateText` via `@ai-sdk/anthropic`, mock mode gated on `MOCK_LLM=1` or missing key; scoring is deterministic per spec.
- Verdict: accepted, **0 fix rounds** needed. Known UX quirk kept as-is: a fresh application scores 0 until documents are uploaded (consequence of the spec's −25-per-missing-document weight with 8 required documents).

## Estimated cost (estimate — not a bill)

Prices looked up on 2026-11-01 from the official pricing page (https://platform.claude.com/docs/en/about-claude/pricing), USD per million tokens:

| Model | Input | Output | Cache write (5m) | Cache read |
|---|---|---|---|---|
| Claude Sonnet 5.5 (the Agent tool's "sonnet" alias is assumed to resolve to the latest Sonnet) | $2 | $10 | $2.50 | $0.10 |
| Claude Fable 5.1 (main agent) | $10 | $50 | $12.50 | $0.25 |

**Build (Sonnet subagent)** — the Agent tool reported 107,158 tokens total and does not split input/output; the subagent could not see its own usage. Assuming an 85/15 input/output split typical of agentic coding runs: ~91,000 input × $2 = $0.18 and ~16,000 output × $10 = $0.16 → **≈ $0.34** (upper bound if every token were output: $1.07).

**Research, review, docs (Fable main agent)** — no usage tool was available in this session, so this is a rough reconstruction from the context size (~120k tokens at the end of the run) and the number of model turns (~55): cumulative input ≈ 5.0M tokens, of which ~90% are prompt-cache reads (4.5M × $0.25 = $1.13) and ~10% fresh/cache-write tokens (0.5M × $12.50 = $6.25); output ≈ 50k tokens × $50 = $2.50 → **≈ $9.9**. Without prompt caching the same run would be ≈ $50 of input alone, so treat $10–$50 as the plausible range.

**Total estimate: ≈ $10.2** (range $10–$51), of which the actual code build was ≈ $0.34. Fix rounds: 0.
