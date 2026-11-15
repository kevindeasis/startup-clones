# Build log — 2026-11-15 Kairos Health clone

## Pick
Kairos Health (YC F26), "AI front desk that fills every chair for dental practices". Candidates considered and skipped: Lightfield (same company as the already-cloned Neomatter), GodHands (public positioning is inconsistent: knowledge base vs computer-use layer), Quivly AI (customer-success agents; product less crisply described), Pomerado/Simantic/Agent37 (already cloned or infra-heavy).
Sources: kairoshealthai.com, ycombinator.com/companies/kairos-health, Decisions in Dentistry (2026-06-09). news.ycombinator.com/launches was reachable; the YC directory page was reachable via WebFetch.

## Pricing (fetched 2026-11-15 from https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 5.5: $2 / MTok input, $10 / MTok output (cache hits $0.10). Newest Sonnet listed; the "sonnet" alias is assumed to resolve to it.
- Claude Fable 5.1 (this agent): $10 / MTok input, $50 / MTok output (cache hits $0.25).

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens as reported) | Notes |
|---|-------|---------|--------------------------------------|-------|
| 1 | sonnet (alias assumed → Claude Sonnet 5.5) | Build ChairFill end to end (app, tests, README) per SPEC.md + BUILD_PROMPT.md | **158,111 total** (`subagent_tokens` from the Agent tool result; no input/output split reported). 27 tool uses, ~11.7 min. | Transcript metadata summed per API call (49 calls): ~94 fresh input, 310,357 cache-write, 5,344,071 cache-read, 222,100 output tokens. These raw figures may double-count streamed usage events, so the reported 158,111 is used as the headline. |

Fix rounds: **0**.

## Fable review (main agent)
- `pytest` → 20 passed.
- Booted `uvicorn app.main:app` with `MOCK_LLM=1`, no API key. `/health` 200 (`mode: mock`); `/`, `/schedule`, `/recall`, `/insurance`, `/calls`, `/messages` all 200.
- Inbound flow over the API: "I need a cleaning" → identity (Maria Gonzalez, 1984-03-12) → `find_patient` + `get_availability`, 3 slots offered → "the second one" → confirmation → "yes please" → `book_appointment` + `end_call`, outcome `booked`; the appointment appeared in `/api/schedule?date=2026-11-20` tagged `ai_inbound`.
- Recall: 9 overdue patients → `POST /api/recall/run` created 9 outreach texts; reply "yes, the first one works" booked Henry Liu via `book_appointment` (status `booked`).
- Insurance: Medicaid-Demo MD-100003 with the right DOB → `eligible: false`, flag `inactive_member`; with a wrong DOB → `member_not_found`.
- FAQ (Saturday hours) → `get_practice_info`, outcome `faq`. Billing dispute → `take_message` + `end_call`, outcome `message_taken`, row visible at `/api/messages`.
- Reviewed `app/llm.py` (manual tool loop, default `tool_choice`, one user message per turn with all tool results, 8-iteration cap) and `app/tools.py` (`strict: true`, `additionalProperties: false`). The live path was not run against the real API (no key in the sandbox).
- Server stopped, local DB removed; `.venv/`, `__pycache__/`, `*.db` ignored.

## Fable (main agent) work — rough estimate, exact counters not visible
Research, spec, prompt, review, doc, architecture page and posts: ~150k fresh input, ~3.5M cached input reads, ~60k output tokens.

## Cost estimate (prices fetched 2026-11-15 from https://platform.claude.com/docs/en/about-claude/pricing)
| Model | Role | Tokens | Price used | Estimate |
|-------|------|--------|-----------|----------|
| Claude Sonnet 5.5 (`sonnet` alias) | build (subagent) | 158,111 total, assumed 80/20 in/out: 126.5k in / 31.6k out | $2 / MTok in, $10 / MTok out | **~$0.57** |
| Claude Sonnet 5.5 — upper bound from raw transcript usage | build (subagent) | 310k cache-write, 5.34M cache-read, 222k out | $2.50 cache-write, $0.10 cache-read, $10 out per MTok | ~$3.53 |
| Claude Fable 5.1 | research, review, docs (main agent) | ~150k in, ~3.5M cache-read, ~60k out | $10 / MTok in, $0.25 cache-read, $50 / MTok out | **~$5.38** |
| **Total** | | | | **~$5.95** (headline) to ~$8.9 (if the upper-bound build figure is right) |

All figures are estimates. The Fable numbers are a rough count because this session does not expose its own token counters.
