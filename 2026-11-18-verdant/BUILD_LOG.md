# BUILD_LOG.md — 2026-11-18 Verdant clone

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- 09:xx UTC — Step 1: repo located at /home/user/startup-clones, on `main`, identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded.
- Step 2: research via web search (YC Launch HN list, F26/S26 directories, Verdant YC page and
  launch post, verdantapp.com). Pick: **Verdant (YC S26)** — AI permitting for local governments.
  Verified npm packages: ai 7.0.176, @ai-sdk/anthropic 4.0.106, @ai-sdk/react 4.0.180,
  next 16.4.6, minisearch 7.2.0, unpdf 2.2.1, zod 4.6.7. Pricing page fetched
  (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5 $2 in / $10 out per MTok,
  Fable 5.1 $10 in / $50 out per MTok.
- Step 3: SPEC.md written; build delegated to Sonnet subagent (see BUILD_PROMPT.md).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (claude-sonnet-5-5 assumed) | Full build of the clone from SPEC.md (scaffold, data, rule engine, retrieval, API routes, UI, tests, smoke script, README) | 97,036 (`subagent_tokens`), 17 tool uses, 6m17s | All six verification commands passed on first attempt; no fix rounds needed |

## Review by the main agent (Fable)
- Re-ran `npm run typecheck`, `npm run lint`, `npm test` (12/12), `npm run build`, `npm run smoke` (SMOKE PASSED) — all exit 0 in mock mode with no API key.
- Drove the UI with Playwright against `next start`: discovery chat recommends the fence permit with
  "Start application" buttons; the fence intake form renders 11 controls and the pre-check shows
  checks; the staff dashboard lists 3 seeded applications; APP-1001 review shows 1 fail
  (3 ft side setback vs § 17.20.030) and 1 needs_info (site plan, § 17.50.010); the staff report
  renders with a Recommendation section; no console or page errors; no horizontal scroll at 390 px.
- Exercised `/api/extract` with a .txt attachment and `/api/precheck` with a 7 ft fence (fail + needs_info).
- Deviations from spec noted: `unpdf` resolved to 1.9.x (spec said 2.x; API identical), one extra
  route `/api/extract`, PDF path not exercised with a real PDF fixture, live (keyed) mode not run.
- Fix rounds: 0.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-18 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5.

| Role | Model | Input tokens | Output tokens | Price in / out (per MTok) | Est. cost |
|------|-------|-------------:|--------------:|---------------------------|----------:|
| Build (Sonnet subagent) | Claude Sonnet 5.5 | ~70,000 | ~27,000 (97,036 total reported) | $2 / $10 | ~$0.41 |
| Research, review, docs (Fable) | Claude Fable 5.1 | ~250,000 (fresh tokens: web pages, code, tool output) | ~40,000 (spec, prompts, doc, architecture page, posts) | $10 / $50 | ~$4.50 |
| **Total** | | | | | **~$4.90** |

Notes: the Sonnet total is split 70/30 input/output as the subagent reported its own split only
roughly. The Fable figures exclude prompt-cache reads of repeated context, which are billed at
$0.25/MTok and would add well under a dollar.
