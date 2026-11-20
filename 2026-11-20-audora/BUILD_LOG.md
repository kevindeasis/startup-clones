# BUILD_LOG.md — 2026-11-20 Audora clone ("FullCast")

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- Step 1: repo located at /home/user/startup-clones, synced to `main` (ea177ba), identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded ("Everything up-to-date").
- Step 2: research via web search + WebFetch (HN /launches index, lemstudio and extruct F26 batch lists,
  YC company page for Audora, Fondo launch write-up 2026-11-10, huntscreens listing). The YC
  /launches index returned only a page title; ycombinator.com/companies/audora was reachable.
  Pick: **Audora (YC F26)** — audiobooks where every character has its own voice.
  Verified npm packages 2026-11-20: ai 7.0.177, @ai-sdk/anthropic 4.0.106, next 16.4.6, zod 4.6.7,
  @mozilla/readability 0.6.0, jsdom 31.0.1. Node 22.23.5 in the sandbox. No ANTHROPIC_API_KEY present,
  so the build is verified in mock mode.
  Pricing page fetched (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5
  $2 in / $10 out per MTok (cache write $2.50, cache read $0.10); Fable 5.1 $10 in / $50 out per MTok.
- Step 3: SPEC.md written; build delegated to a Sonnet subagent (see BUILD_PROMPT.md).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (resolved to claude-sonnet-5-5 per transcript metadata) | Full build from SPEC.md: Next.js 16 scaffold, JSON store, Readability importer with SSRF guard, chunker, heuristic attributor, live AI SDK path (generateText + Output.object), merge/casting, 6 API routes, library + workspace pages, Web Speech player, 24 vitest tests, smoke script, README | 152,210 (`subagent_tokens`), 38 tool uses, 13m29s | All checks passed on its first report; transcript-level raw usage: 69 assistant turns, 178,423 output, 290,876 cache-write, 7,085,393 cache-read, 132 uncached input tokens (see cost section) |

## Review by the main agent (Fable)
- Re-ran `npm run typecheck`, `npm run lint`, `npm test` (24/24), `npm run build` (8 routes), `npm run smoke`
  (SMOKE PASSED, 15 checks: samples, create, sync generate in mock mode, 255 segments / cast of 6 for Alice,
  164 / 6 for Oz, paragraph coverage in order, PATCH cast persisted + range validation, exports, ftp:// rejected,
  Readability import from a local test page, async generate completes, 404 for unknown story).
- Drove the UI with Playwright against `next start` at 1280 px and 390 px: load sample → workspace → Generate →
  READY/MOCK badges, 2/2 chunks, script with coloured speaker labels, cast panel, sticky player (playback disabled
  notice because headless Chromium exposes no voices). 0 console errors, 0 page errors,
  `scrollWidth == innerWidth` at both widths. Read the 390 px screenshot: no clipping or overflow.
- Spot-checked the screenplay export: tags ("said Alice", "the March Hare said") stay narration, quotes are
  attributed correctly, group lines ("No room! No room!" they cried) fall to Unknown Speaker as designed.
- Read `llm.ts`, `heuristic.ts`, `cast.ts`, `generate.ts`, `importer.ts`, the stories and generate routes, README.
  Live path uses `generateText` + `Output.object` from `ai` 7.0.177 (generateObject is deprecated there) and is
  covered only by a mocked model in tests; no API key in the sandbox, so it is not exercised against the real API.
- Deviations accepted: `ai/test` MockLanguageModelV4 used for the live-path unit test; `generate?sync=1` on a
  ready story regenerates; two optional extra env vars (`MOCK_CHUNK_DELAY_MS`, `ALLOW_PRIVATE_URLS`); sample
  excerpts were written from memory by the subagent and may differ slightly from the Gutenberg text.
- Fix rounds: 0.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-20 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5
($2 input / $10 output per MTok; cache write $2.50, cache read $0.10); the subagent transcript metadata
confirms `claude-sonnet-5-5`. Claude Fable 5.1: $10 input / $50 output per MTok.

| Role | Model | Tokens used for the estimate | Price in / out (per MTok) | Est. cost |
|------|-------|-----------------------------|---------------------------|----------:|
| Build (Sonnet subagent), harness-reported `subagent_tokens` | Claude Sonnet 5.5 | 152,210 total; assumed 60% input = 91,326, 40% output = 60,884 | $2 / $10 | ~$0.79 |
| Build (Sonnet subagent), transcript-level incl. cache traffic (upper bound) | Claude Sonnet 5.5 | 290,876 cache-write, 7,085,393 cache-read, 178,423 output, 132 input | $2.50 / $0.10 / $10 | ~$3.22 |
| Research, review, docs (Fable, main agent) | Claude Fable 5.1 | ~130,000 input, ~40,000 output (rough count of the session) | $10 / $50 | ~$3.30 |
| **Total** | | | | **~$4.10 (harness count) to ~$6.50 (upper bound)** |

The two Sonnet rows are alternative views of the same work, not additive: the harness figure is the number the
task asks for; the transcript figure counts every cached re-read of the growing context at cache-read rates.
