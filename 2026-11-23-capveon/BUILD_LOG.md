# BUILD_LOG.md — 2026-11-23 Capveon clone ("PreBid")

Running log of model usage for this daily clone run. Token counts for subagents come from the
`subagent_tokens` figure in each Agent tool result; the main-agent (Fable) figure is a rough estimate.

## Timeline
- Step 1: repo located at /home/user/startup-clones, synced to `main` (ce76ef0), identity set to
  `Kevin De Asis <deasis@ualberta.ca>`, `git push --dry-run origin main` succeeded ("Everything up-to-date").
  29 previous clone folders listed; artifact list checked (previous picks skipped).
- Step 2: research via web search + WebFetch. news.ycombinator.com/launches reachable (60 latest Launch HNs
  across two pages); ycombinator.com/companies/<slug> pages reachable. Third-party F26 lists used:
  extruct.ai (30 companies), lemstudio.co (~200), techstartupslist.com. Candidates considered and rejected:
  Tire Swing (turned out to be W25 and is a full leasing/eligibility platform with document forensics),
  Clean (buying-intent signals; needs live external signal feeds to be meaningful), Lark (YC listing is
  S25 and ambiguous between a testing product and a billing product), Maritime/Agent37/Ascii (agent
  infrastructure, not a thin LLM layer), Subvocal/Axonnic (hardware).
  Pick: **Capveon (YC F26)** — "AI for finding, understanding, and winning government work for
  manufacturers and contractors" (capveon.ai, ycombinator.com/companies/capveon; founders Finn Lancaster
  and Brison Moorhead; secondary coverage: fondo.com blog, dealroom.co listing). Product modules taken
  from capveon.ai: Early signals, Opportunities with fit scores, Bid review with page citations,
  Pursuits task plans with drafts, Spend, Contacts, addendum tracking.
  Pricing page fetched (https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5
  $2 in / $10 out per MTok (cache write $2.50, cache read $0.10); Fable 5.1 $10 in / $50 out per MTok
  (cache write $12.50, cache read $0.25). Model IDs from platform.claude.com/docs/en/models/overview:
  claude-sonnet-5-5, claude-haiku-5-5, claude-opus-5-5, claude-fable-5-2.
  Verified npm packages 2026-11-23 via `npm view`: ai 7.0.179, @ai-sdk/anthropic 4.0.107, next 16.4.6,
  zod 4.6.7, vitest 5.1.1, minisearch 7.2.0, pdf-parse 2.4.5, tsx 4.23.15. Node v22.23.5, npm 10.9.9.
  No ANTHROPIC_API_KEY in the sandbox, so the build is verified in mock mode.
- Step 3: SPEC.md written (230 lines); build delegated to a Sonnet subagent (prompt saved verbatim in
  BUILD_PROMPT.md).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens total) | Outcome |
|---|-------|---------|-------------------------------|---------|
| 1 | sonnet (alias; assumed to resolve to Claude Sonnet 5.5, the newest Sonnet on the pricing page) | Full build from SPEC.md: Next.js 16 scaffold (by hand), JSON store with mutex + atomic writes, page splitter (markers / form feed / PDF via pdf-parse), deterministic fit scorer, requirements rule engine + key-field extraction, backward-scheduled pursuit planner, addendum change pipeline, MiniSearch BM25 retrieval, mock + live (AI SDK `generateText` + `Output.object`) LLM layer, 15 API routes, 9 pages, 8 client components, fictional seed (profile, 5 agencies, 9 documents, 58 awards, 12 contacts), 36 vitest tests, 15-step smoke script, README | 193,242 (`subagent_tokens`), 33 tool uses, 14m57s | All acceptance checks passed on its first report; the subagent's own estimate was ~290k input / ~55k output, which it could not measure |

## Review by the main agent (Fable)
- Re-ran `npm run typecheck`, `npm run lint`, `npm test` (36/36 in 7 files), `npm run build` (24 dynamic routes, no
  warnings), `npm run seed` (profile 1, agencies 5, documents 9, signals 12, awards 58, contacts 12; stages
  discussion/planned/budgeted/design/solicitation all present; Mill Creek Lift Station RFP fit 85 strong vs Route 9
  Resurfacing 15 weak and County Road 12 Resurfacing 30 weak), `PORT=3131 npm run start` + `PORT=3131 npm run smoke`
  (15 steps, `All 15 smoke steps passed`: health mock; wastewater filter sorted by fit; stage coverage and fit
  ordering; "When are bids due?" → December 18 with a p.1 citation; roof-warranty question → "Not found in this
  document." with no citations; RFP requirements bond 5 % and NSF 61 both `meetsProfile: yes`; pursuit from RFP →
  10 tasks (8 template + 2 llm-source) all due ≤ 2026-12-18; task PATCH persists; draft letter 80–300 words naming
  City of Brightwater and Northline Pump & Valve; addendum → due_date change to 2027-01-08, pursuit dueDate and open
  tasks shifted, 6 timeline events; Brightwater spend by FY non-zero with contacts; 2-page multipart .txt upload →
  2 pages + signal; validation 400/404; nine HTML pages 200).
- Spot-checked the API payloads by hand: key fields (engineer's estimate $1.85M p.1, bid due 2026-12-18 p.1, pre-bid
  2026-12-02, questions 2026-12-09, bid bond 5 % p.3) all carry the right page and verbatim quote; "What bid bond is
  required?" answers with the p.3 sentence; the drafted letter uses only the profile's two won past bids and listed
  certifications. After the addendum is ingested, the bids-due answer surfaces both the original and the extended
  date (documented in the README as a known limitation: conflicting values are surfaced, not resolved).
- Read `fit.ts` (weights match the spec: 40/30/15/15, adjacency within the water group, 7 pts for unknown value),
  `llm/index.ts` (mode switch), `llm/live.ts` (`generateText` + `Output.object`, `maxRetries: 2`, model from
  `PREBID_MODEL`), the README (covers company, clone scope, architecture, tools table, setup, env vars, limitations,
  next 3), `.gitignore` and `.env.example`. Live path type-checks but was not exercised (no key in the sandbox).
- Deviations accepted: extra fields (`Requirement.documentId`, `Task.anchored`, `Document.keyFields/changes/error`,
  `Pursuit.fitScore`, citation `documentId`); 58 awards instead of ~40; fiscal year = calendar year; profile regions
  are county names only; pre-bid and questions tasks are anchored to the RFP's own dates and do not shift with the
  bid due date; addenda only modify a pursuit that already exists at ingest time; smoke needs a fresh seed.
- Fix rounds: 0.
- Cleanup: server stopped, `data/store`, `.next` and tsbuildinfo removed before commit.

## Cost estimate (ESTIMATE — token counts for Fable are approximate)
Prices fetched 2026-11-23 from https://platform.claude.com/docs/en/about-claude/pricing.
The `sonnet` alias is assumed to resolve to the newest Sonnet listed there, Claude Sonnet 5.5
($2 input / $10 output per MTok; cache write $2.50, cache read $0.10). Claude Fable 5.1 (this session's model):
$10 input / $50 output per MTok (cache write $12.50, cache read $0.25).

| Role | Model | Tokens used for the estimate | Price in / out (per MTok) | Est. cost |
|------|-------|-----------------------------|---------------------------|----------:|
| Build (Sonnet subagent), harness-reported `subagent_tokens` | Claude Sonnet 5.5 | 193,242 total; assumed 60% input = 115,945, 40% output = 77,297 | $2 / $10 | ~$1.00 |
| Research, review, docs (Fable, main agent) | Claude Fable 5.1 | ~190,000 input, ~45,000 output (rough count of the session: ~14 web fetches/searches, spec, review, doc, architecture page, posts) | $10 / $50 | ~$4.15 |
| **Total** | | | | **~$5.15** |

Cache reads/writes are not itemised (the harness does not report them per agent); with heavy prompt caching the real
bill is likely lower on input and the figure above should be read as an order-of-magnitude estimate.
