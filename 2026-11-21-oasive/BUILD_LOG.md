# BUILD_LOG.md — 2026-11-21 Oasive clone ("MuniWatch")

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- Step 1: repo located at /home/user/startup-clones, synced to `main` (2a90072), identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded ("Everything up-to-date").
- Step 2: research via web search + WebFetch. news.ycombinator.com/launches was reachable (30 most recent
  Launch HNs); ycombinator.com/launches and the YC directory returned only a page title, but
  ycombinator.com/companies/<slug> pages were reachable. Third-party F26 lists used:
  techstartupslist.com (221 F26 companies), startups.fru.dev (~100), roundfunded.com (39).
  Candidates considered and rejected: Elimentary (private-credit back office; too close to the
  Covera/Hesper insurance-ops picks), GodHands (needs app-activity capture), Quivly (needs CRM/Slack data).
  Pick: **Oasive (YC F26)** — AI credit research for municipal bond investors.
  Pricing page fetched (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5
  $2 in / $10 out per MTok (cache write $2.50, cache read $0.10); Fable 5.1 $10 in / $50 out per MTok
  (cache write $12.50, cache read $0.25).
  Sources for the pick: YC company page (ycombinator.com/companies/oasive), YC launch post
  "Oasive: Credit research for municipal bond investors" (ycombinator.com/launches/Xkd-..., posted ~2026-11-19,
  listed as a fresh launch in the YC Women's Alumni newsletter of 2026-11-20), oasive.ai product page,
  runtimewire.com article of 2026-09-23 (out-of-stealth: rates research $200/user/mo, agency MBS $12k/yr).
  Verified npm packages 2026-11-21 via registry.npmjs.org: ai 7.0.179, @ai-sdk/anthropic 4.0.107,
  next 16.4.6, zod 4.6.7, unpdf 2.2.1, minisearch 7.2.0, rss-parser 3.13.0, @mozilla/readability 0.6.0,
  jsdom 31.0.1, vitest 5.1.1. Model IDs from platform.claude.com/docs/en/models/overview:
  claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5, claude-fable-5-2. No ANTHROPIC_API_KEY in the
  sandbox, so the build is verified in mock mode.
- Step 3: SPEC.md written (202 lines); build delegated to a Sonnet subagent (prompt saved verbatim in
  BUILD_PROMPT.md, 20,267 chars).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (alias; assumed to resolve to Claude Sonnet 5.5, the newest Sonnet on the pricing page) | Full build from SPEC.md: Next.js 16 scaffold, JSON store, page-aware chunker, citation verifier, MiniSearch retrieval, mock + live (AI SDK `generateText` + `Output.object`) pipelines, 15 API routes, 6 pages, 9 components, 6 fictional obligors / 15 seed documents / 13 seed articles, 19 vitest tests, smoke script, README | 166,700 (`subagent_tokens`), 63 tool uses, 12m57s | All acceptance checks passed on its first report; the subagent's own estimate was ~180–220k input / ~60–70k output, which it could not measure |

## Review by the main agent (Fable)
- Re-ran `npm run typecheck`, `npm run lint`, `npm test` (19/19), `npm run build` (21 routes), `npm run seed`
  (6 obligors, 15 documents, 13 news items, 10 credit-relevant, 3 filtered), `npm run start` + `npm run smoke`
  (30 checks, `SMOKE PASSED`: health mock, 6 obligors, hospital days-cash for FY2022–FY2024 with quotes on the
  cited pages, .txt upload adds a verified metric on page 2, generated PDF extracts and indexes, pasted downgrade →
  `rating`/relevant/tagged and shown on the obligor page, bake sale filtered, watchlist create/add/filter/remove,
  ask returns 3 resolving citations, two-obligor ask, 127.0.0.1 ingest → 400, unknown obligor → 404).
- Drove the UI with Playwright at 1280 px and 390 px: directory, hospital obligor page (sector metric cards,
  financials table with per-cell source links, 7 events with severity badges, documents, Ask + upload forms), news
  feed with filters, and the Ask flow (typed a question, clicked Ask, got a mock answer with 3 citation chips that
  resolve to document title + page). `scrollWidth == innerWidth` at both widths, 0 console errors, 0 page errors.
  Read the 1280 px obligor screenshot and the 390 px news/ask screenshots: no clipping or overflow.
- Read `llm.ts`, `citations.ts`, `mock.ts` (metric regexes + event rules), `ssrf.ts` (private ranges, DNS check,
  manual redirect), the Brightwater seed audit, seed manifest and README. Live path uses `generateText` +
  `Output.object` from `ai` 7.0.179 (the deprecated `generateObject` also exists); it type-checks but was not
  exercised against the real API (no key in the sandbox).
- Deviations accepted: extra `/documents/[docId]` page; mock extraction adds "Outstanding debt", "Rate increase"
  and "Enplaned passengers" metrics beyond the spec list; a news downgrade creates an event but does not change the
  obligor's rating field; `next-env.d.ts` gitignored; "Last document" dates equal seed time because seed documents
  are ingested at seed time.
- Fix rounds: 0.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-21 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5
($2 input / $10 output per MTok; cache write $2.50, cache read $0.10). Claude Fable 5.1 (this session's model):
$10 input / $50 output per MTok (cache write $12.50, cache read $0.25).

| Role | Model | Tokens used for the estimate | Price in / out (per MTok) | Est. cost |
|------|-------|-----------------------------|---------------------------|----------:|
| Build (Sonnet subagent), harness-reported `subagent_tokens` | Claude Sonnet 5.5 | 166,700 total; assumed 60% input = 100,020, 40% output = 66,680 | $2 / $10 | ~$0.87 |
| Research, review, docs (Fable, main agent) | Claude Fable 5.1 | ~150,000 input, ~35,000 output (rough count of the session: ~20 web fetches/searches, spec, review, doc, architecture page, posts) | $10 / $50 | ~$3.25 |
| **Total** | | | | **~$4.10** |

Cache reads/writes are not itemised (the harness does not report them per agent); with heavy prompt caching the real
bill is likely lower on input and the figure above should be read as an order-of-magnitude estimate.
