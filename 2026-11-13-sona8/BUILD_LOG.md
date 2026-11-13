# Build log — 2026-11-13 Sona8 clone ("Worktalk")

Scheduled daily run. Main agent: Fable 5.1 (research, spec, review, docs). Build: Sonnet subagent (alias "sonnet").

## Timeline
- Step 1: repo found at /home/user/startup-clones, main up to date, identity set to deasis@ualberta.ca, `git push --dry-run origin main` → "Everything up-to-date" (push access OK).
- Step 2: researched YC F26 batch lists (lemstudio, fru.dev, extruct), HN launches page returned HTTP 429 (so relied on search snippets and secondary coverage). Candidates considered: Sona8, Kairos Health, Gradon, Databuddy. Picked Sona8: clearest public description (YC page + fondo + trendingtopics coverage), launched Oct 2026, thin layer on top of an LLM interviewer + structured extraction + diagram rendering.
- Verified npm packages via registry metadata: ai 7.0.172, @ai-sdk/anthropic 4.0.104, @ai-sdk/react 4.0.176, next 16.4.6, better-sqlite3 13.1.1, zod 4.6.7, mermaid 12.3.0, vitest 5.1.0.
- Pricing fetched live from https://platform.claude.com/docs/en/about-claude/pricing: Sonnet 5.5 $2 in / $10 out per MTok; Fable 5.1 $10 in / $50 out per MTok.

## Subagent calls
(appended below as they happen)

### Round 0 — initial build (Sonnet subagent, model alias "sonnet" → Claude Sonnet 5.5)
- Purpose: build the full app per SPEC.md (prompt: BUILD_PROMPT.md, Round 0).
- Duration ≈ 9 min, 34 tool uses. Tokens reported by the Agent tool result: `subagent_tokens` = 123,563 total. The subagent itself estimated ≈150k input / ≈35k output (its environment does not expose exact counts), so the 123,563 total is split pro rata ≈ 81% input / 19% output → ≈ 100,000 input / ≈ 23,500 output for the cost estimate.
- Subagent result: build, lint, 10 vitest tests and the curl end-to-end flow all passed in mock mode; it flagged that it had not rendered the Mermaid map in a browser.

### Main-agent review of round 0 (Fable 5.1)
- Re-ran `npm run build`, `npm test` (4 files / 10 tests pass), `npm run lint` (clean).
- Re-ran the curl end-to-end flow on a fresh study ("Invoice approval — review"): 7 chat turns → coverage 7/7 areas → finish → extraction 6 steps / 3 pain points → synthesise → context.json 6 mergedSteps, 4 recommendations → context.md contains one ```mermaid block → study page 200 with title → demo study listed on `/`.
- Headless Chromium (Playwright): demo dashboard renders the Mermaid map (26 SVG nodes, 5 exception diamonds). **Bug found:** `/interview/[token]` crashed into Next's error boundary; dev-mode stack showed `TypeError: destroy is not a function` caused by a `useEffect` arrow returning `scrollIntoView(...)`'s value as its cleanup.
- Sent fix round 1 (prompt appended to BUILD_PROMPT.md).

### Round 1 — fix (same Sonnet subagent, resumed)
- Purpose: fix the interview-page crash (useEffect returning a non-function cleanup) and verify in headless Chromium (prompt: BUILD_PROMPT.md, Round 1).
- Duration ≈ 1.5 min, 5 tool uses. Agent tool cumulative `subagent_tokens` after this round = 129,513 → round 1 ≈ 5,950 tokens (the subagent's own guess was ≈15k in / 3k out; the tool count is used).
- Result: one-line fix in `src/components/InterviewClient.tsx`; README limitation removed and a "Verification" section added; build/test/lint pass; Playwright script passes 6/6 assertions (streamed reply, coverage tick, no page errors, thank-you screen, map with 26 nodes, no dashboard errors).

### Main-agent re-verification of round 1 (Fable 5.1)
- Rebuilt, started `npm start`, re-ran the Playwright script: 6/6 PASS. Server stopped. No further fix rounds needed (1 fix round total).

## Cost estimate (estimate only)
Prices fetched live from https://platform.claude.com/docs/en/about-claude/pricing on 2026-11-13. The "sonnet" alias is assumed to resolve to Claude Sonnet 5.5 (newest Sonnet listed: $2 / MTok input, $10 / MTok output). Main agent: Claude Fable 5.1 ($10 / MTok input, $50 / MTok output).

| Role | Model | Input tokens | Output tokens | Est. cost |
|---|---|---:|---:|---:|
| Build (Sonnet subagent, rounds 0+1) | Claude Sonnet 5.5 | ≈104,900 | ≈24,600 | ≈ $0.21 + $0.25 = **$0.46** |
| Research, review, docs (Fable) | Claude Fable 5.1 | ≈240,000 | ≈35,000 | ≈ $2.40 + $1.75 = **$4.15** |
| **Total** | | | | **≈ $4.61** |

Notes: build tokens are the Agent tool's reported total of 129,513, split ≈81/19 input/output per the subagent's own ratio estimate. Fable tokens are a rough proxy from the session's context counter (≈225k consumed at the time of writing, rounded up to cover the doc and architecture page) plus an output guess; they are not a billing record. Prompt caching would lower the real bill.
