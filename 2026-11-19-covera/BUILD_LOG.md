# BUILD_LOG.md — 2026-11-19 Covera clone ("BrokerDesk")

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- Step 1: repo located at /home/user/startup-clones, synced to `main` (ad38df6), identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded (exit 0).
- Step 2: research via web search (HN Launch list, YC F26 directories on roundfunded/lemstudio, YC
  company pages for Covera, Gradon, Tire Swing; covera-agents.com). ycombinator.com pages were
  reachable through WebFetch; the YC /launches index returned only a title, so HN /launches and
  third-party batch lists were used instead. Pick: **Covera (YC F26)** — AI quoting workspace for
  insurance brokers. Verified npm packages 2026-11-19: ai 7.0.177, @ai-sdk/anthropic 4.0.106,
  @ai-sdk/react 4.0.181, next 16.4.6, zod 4.6.7, unpdf 2.2.1, vitest 5.1.1.
  Pricing page fetched (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5
  $2 in / $10 out per MTok; Fable 5.1 $10 in / $50 out per MTok.
- Step 3: SPEC.md written; build delegated to a Sonnet subagent (see BUILD_PROMPT.md).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (claude-sonnet-5-5 assumed) | Full build from SPEC.md: scaffold, seed data, mock extractor, requirements engine, carrier mapper, mock portals + rating, quoting agent, compare, rounding, 5 pages, 11 API routes, 19 vitest tests, smoke script, README | 131,548 (`subagent_tokens`), 23 tool uses, 9m36s | All checks passed on its first report; transcript-level raw usage: ~170k output, ~255k cache-write, ~3.9M cache-read tokens across 44 assistant turns (see cost section) |
| 2 | sonnet (same agent, resumed) | Fix round: wrap tables in overflow containers + stack grids at phone width; follow-up draft when nothing is missing; one new unit test | 135,011 cumulative (`subagent_tokens`), i.e. +3,463 for the round; 3 assistant turns | typecheck, lint, 20 tests, build, SMOKE PASSED (28) re-run by the subagent and by the main agent |

## Review by the main agent (Fable)
- Round 1 review: re-ran `npm run typecheck`, `npm run lint`, `npm test` (19/19), `npm run build`, `npm run smoke`
  (SMOKE PASSED, 28 checks) against `next start -p 3111` with no API key. Drove the full UI with Playwright
  (intake → load landscaper sample → extract → save → key carrier portals → 4 quotes → compare → select →
  dashboard shows `selected` + mock badge → book → find gaps → draft outreach → portal page): no console errors,
  no page errors, no 4xx/5xx. Found two issues: horizontal overflow at 390 px on `/book` and `/portal/[id]`
  (tables had no scroll container), and the mock follow-up email read "(nothing further needed right now)"
  when nothing was missing. Sent one focused fix prompt (BUILD_PROMPT.md, round 2).
- Round 2 review: re-ran all five commands (20/20 tests, build OK, SMOKE PASSED 28) and the Playwright flow
  again; overflow is gone on `/`, `/intake`, `/book`, `/portal/harborline` at 390 px; still no console errors.
- Deviations from spec accepted: quote logs render after the run instead of streaming; comparison carries an
  extra `diff` field; portal responses are per-line `results[]`; saved opportunity page is read-only (edit on
  `/intake` before saving); extra `/api/samples/[id]` route; live (keyed) Anthropic path not exercised.
- Fix rounds: 1.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-19 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5
($2 input / $10 output per MTok; cache write $2.50, cache read $0.10). Claude Fable 5.1: $10 input / $50 output per MTok.

| Role | Model | Tokens used for the estimate | Price in / out (per MTok) | Est. cost |
|------|-------|-----------------------------|---------------------------|----------:|
| Build (Sonnet subagent), harness-reported `subagent_tokens` | Claude Sonnet 5.5 | 135,011 total (both rounds); assumed 60% input = 81,007, 40% output = 54,004 | $2 / $10 | ~$0.70 |
| Build (Sonnet subagent), transcript-level incl. cache traffic (upper bound) | Claude Sonnet 5.5 | ~262k cache-write, ~4.28M cache-read, ~174k output (47 assistant turns) | $2.50 / $0.10 / $10 | ~$2.82 |
| Research, review, docs (Fable, main agent) | Claude Fable 5.1 | ~120,000 input, ~45,000 output (rough count of the session) | $10 / $50 | ~$3.45 |
| **Total** | | | | **~$4.15 (harness count) to ~$6.30 (upper bound)** |

The two Sonnet rows are alternative views of the same work, not additive: the harness figure is the number the
task asks for; the transcript figure counts every cached re-read of the growing context at cache-read rates.
