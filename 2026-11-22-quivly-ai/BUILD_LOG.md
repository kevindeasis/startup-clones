# BUILD_LOG.md — 2026-11-22 Quivly AI clone ("PostSale")

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- Step 1: repo located at /home/user/startup-clones, synced to `main` (d469a2f), identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded ("Everything up-to-date").
- Step 2: research via web search + WebFetch. news.ycombinator.com/launches reachable (30 latest Launch HNs);
  ycombinator.com/companies/<slug> pages reachable. Third-party F26 lists used: extruct.ai (30 companies),
  startups.fru.dev (first 100 of 239). Candidates considered and rejected: Lightfield (its domain now
  redirects to Neomatter, already cloned 2026-10-26), Native (needs ad/social publishing), Papaya
  (needs production agent traces; close to Agnost), Index Law (legal agent; close to Neomatter),
  Shire Intelligence (camera/computer vision), Rezora (voice; close to Speko/Kairos Health).
  Pick: **Quivly AI (YC F26)** — "AI agents that run onboarding, adoption, and renewals"
  (quivly.ai, ycombinator.com/companies/quivly-ai; founders Chandrika Maheshwari and Tanay Agrawal;
  secondary coverage: huntscreens.com listing, CMU VentureBridge 2025 spotlight).
  Pricing page fetched (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5
  $2 in / $10 out per MTok (cache write $2.50, cache read $0.10); Fable 5.1 $10 in / $50 out per MTok
  (cache write $12.50, cache read $0.25). Model IDs from platform.claude.com/docs/en/models/overview:
  claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5, claude-fable-5-2.
  Verified npm packages 2026-11-22 via registry.npmjs.org: ai 7.0.179, @ai-sdk/anthropic 4.0.107,
  next 16.4.6, zod 4.6.7, vitest 5.1.1 (minisearch 7.2.0 and tsx verified on the previous run).
  No ANTHROPIC_API_KEY in the sandbox, so the build is verified in mock mode.
- Step 3: SPEC.md written (215 lines); build delegated to a Sonnet subagent (prompt saved verbatim in
  BUILD_PROMPT.md).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (alias; assumed to resolve to Claude Sonnet 5.5, the newest Sonnet on the pricing page) | Full build from SPEC.md: Next.js 16 scaffold (by hand), JSON store with mutex + atomic writes, health formulas, rule engine with dedupe, mock + live (AI SDK `generateText` + `Output.object`) pipelines, 12 API routes, 6 pages, 3 component files, 8 fictional accounts / 96 usage weeks / 87 tickets / 16 invoices / 18 notes / 1 transcript / 10 radar articles, 18 vitest tests, 17-step smoke script, README | 173,748 (`subagent_tokens`), 33 tool uses, 12m30s | All acceptance checks passed on its first report; the subagent's own estimate was ~250k input / ~60k output, which it could not measure |

## Review by the main agent (Fable)
- Re-ran `npm run typecheck`, `npm run lint`, `npm test` (18/18), `npm run build` (19 routes), `npm run seed`
  (8 accounts, 96 usage weeks, 87 tickets, 16 invoices, 18 notes, 1 project / 10 tasks, 10 signals, 10 actions:
  expansion ×4, usage_drop adoption_workshop / check_in / win_back, onboarding_stalled, renewal_prep, billing_risk;
  health 96/54/65/48/82/95/71/94 → green, amber and red all present), `PORT=3111 npm run start` + `npm run smoke`
  (17 steps, `All steps passed`: health mock; portfolio bands; Brightwater 45 % → adoption_workshop, Copperline 30 % →
  check_in, Fernhollow 70 % → win_back with the percentage in the rationale; kickoff → 4 tasks + 1 blocker + recap;
  task PATCH persists; CSV drop on the control account 94 → 68 + win_back action; "X acquires Y" → expansion action;
  irrelevant paste → relevant:false; radar validation 400; renewal brief six headings + proposedArr 378000 / 24 mo;
  ask → 3 resolving citations; accept → save_play project with 3 tasks; snooze/dismiss; analyze twice → +0/+0;
  six pages HTTP 200). Server log: no errors or warnings.
- Drove the UI with Playwright at 1280 px and 390 px: portfolio, Brightwater Customer 360 (usage chart with the two
  red drop weeks and the quota line, health breakdown with input numbers and trend, action card with rationale and
  next steps, kickoff form, renewal brief button, Ask box, timeline), actions feed with filters, radar, ask.
  `scrollWidth == innerWidth` at both widths on all five pages, 0 console errors, 0 page errors. Read the 1280 px
  Customer 360 and portfolio screenshots and the 390 px actions screenshot: no clipping or overflow.
- Read `health.ts` (formulas match the README table), `analyze.ts` (rules, dedupe keys, snooze expiry), `llm.ts`
  (mode switch, 30 s AbortSignal timeout, mock fallback flagged `degraded`, brief heading check), `prompts.ts`
  (every prompt says "use ONLY the data provided, never invent numbers"), `mock.ts` (speaker-label transcript parser),
  the Quillstone seed transcript, the test list and the README. Live path uses `generateText` + `Output.object`
  from `ai` 7.0.179 (`generateObject` is deprecated there); it type-checks but was not exercised against the real
  API (no key in the sandbox).
- Deviations accepted: `Action.dedupeKey` field added beyond the spec's data model; `ANTHROPIC_CLASSIFY_MODEL`
  extra env var; smoke re-seeds first (`SMOKE_NO_RESEED=1` to skip); seed dates are shifted by whole weeks so the
  12 usage weeks end at the last complete week; only the latest renewal brief is rendered on the account page.
- Fix rounds: 0.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-22 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5
($2 input / $10 output per MTok; cache write $2.50, cache read $0.10). Claude Fable 5.1 (this session's model):
$10 input / $50 output per MTok (cache write $12.50, cache read $0.25).

| Role | Model | Tokens used for the estimate | Price in / out (per MTok) | Est. cost |
|------|-------|-----------------------------|---------------------------|----------:|
| Build (Sonnet subagent), harness-reported `subagent_tokens` | Claude Sonnet 5.5 | 173,748 total; assumed 60% input = 104,249, 40% output = 69,499 | $2 / $10 | ~$0.90 |
| Research, review, docs (Fable, main agent) | Claude Fable 5.1 | ~160,000 input, ~40,000 output (rough count of the session: ~15 web fetches/searches, spec, review incl. screenshots, doc, architecture page, posts) | $10 / $50 | ~$3.60 |
| **Total** | | | | **~$4.50** |

Cache reads/writes are not itemised (the harness does not report them per agent); with heavy prompt caching the real
bill is likely lower on input and the figure above should be read as an order-of-magnitude estimate.
