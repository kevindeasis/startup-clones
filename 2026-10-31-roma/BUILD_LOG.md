# BUILD_LOG.md — subagent calls and cost tracking (2026-10-31, Roma clone)

| # | Model | Purpose | Input tokens | Output tokens | Notes |
|---|-------|---------|-------------:|--------------:|-------|
| 1 | claude-sonnet (Agent tool, model "sonnet") | Round 0: initial build from SPEC.md (scaffold, DB, operator real+mock, API, UI, MCP server, README, acceptance checks) | see note | see note | Harness reported `subagent_tokens: 116,825` total, 31 tool uses, 690 s. Subagent's own self-estimate: 250–350k input (cumulative context) / 35–45k output. For costing we use the harness total split ~80/20 → ≈93,500 input / ≈23,300 output (estimate). All 9 acceptance checks reported passing in mock mode. |
| 2 | claude-sonnet (same agent, resumed via SendMessage) | Round 1 fix: Tailwind not compiled (Turbopack loader rule dropped from next.config.ts); re-verify with CSS grep + Playwright screenshots; tsc/eslint/npm test | ≈45,000 (self-estimate) | ≈3,000 (self-estimate) | Harness did not report a token count for the resumed turn; subagent self-estimated 40–50k input (incl. 4 screenshots) / ~3k output. Fix confirmed by Fable (see round-1 review below). |

## Fable (main agent) review notes

- Round 0 review: read README, `lib/operator/{real,tools,mock}.ts`; rebuilt DB, `MOCK_LLM=1 npm start`, `GET /` 200, `/api/context` seeded, `npm test` 8/8 PASS, operator check 3 OK (Call the dentist 2026-11-01, Buy milk 2026-11-06), MCP `tools/list` -> 7 tools OK. Playwright screenshots revealed **Tailwind not compiled** (unstyled UI) -> fix round 1.
- Round 1 review: CSS chunk now contains Tailwind utilities; desktop three-pane / mobile stacked layouts confirmed by screenshot; drove the chat UI with Playwright (task card + approval card + item panel render, no console errors). Accepted.
- Fix rounds used: 1 of 2. No application code written by Fable.
- Fable's own work (research, spec, prompts, review, doc, architecture page, posts): estimated from context size at end of run — see the cost table in the doc.
