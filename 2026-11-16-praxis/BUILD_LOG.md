# Build log — 2026-11-16 Praxis clone

## Pick
Praxis (YC F26, launched 2026-10-15 on X by founder Diana Khramina; runpraxis.ai) — "AI agents that run law firm operations, from first inquiry to paid invoice. Agents do the work, lawyers approve."
Candidates considered and skipped today: Tire Swing (affordable-housing compliance; heavy LIHTC/HUD rule content), Oasive (muni-bond credit research; data-heavy), Spacesheep (agent-publishable collaborative docs; broad), Theo (AI site builder + weekly SEO agent; broad), Mirrors (agent-correction infra; thin product description), Covera (insurance-broker quoting across 100+ carrier portals; integration-heavy). Previously cloned companies were excluded by folder name and artifact list.
Sources: ycombinator.com/companies/praxis (reachable via WebFetch), runpraxis.ai, lemstudio.co F26 list (198 companies), news.ycombinator.com/launches (reachable), x.com post (402 — content taken from search snippets only).

## Pricing (fetched 2026-11-16 from https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 5.5: $2 / MTok input, $2.50 5m cache write, $0.10 cache read, $10 / MTok output. Newest Sonnet listed; the Agent tool's "sonnet" alias is assumed to resolve to it.
- Claude Fable 5.1 (this agent): $10 / MTok input, $12.50 cache write, $0.25 cache read, $50 / MTok output.

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens as reported) | Notes |
|---|-------|---------|--------------------------------------|-------|
| 1 | sonnet (alias assumed → Claude Sonnet 5.5) | Build Docketeer end to end (app, 17 tests, README) per SPEC.md + BUILD_PROMPT.md | **149,584 total** (`subagent_tokens` from the Agent tool result; no input/output split reported). 17 tool uses, ~11.1 min. | Transcript metadata summed per API call (32 calls, model `claude-sonnet-5-5`): 62 fresh input, 289,842 cache-write, 3,077,701 cache-read, 200,497 output tokens. The subagent's own estimate was ~100k in / ~48k out. The raw figures may double-count streamed usage events, so 149,584 is the headline. |

Fix rounds: **0**.

## Fable review (main agent), 2026-11-16 06:19–06:21 UTC
- `pytest -q` in mock mode → 17 passed (5.3 s).
- Booted `uvicorn app.main:app --port 8031` with `env -u ANTHROPIC_API_KEY`: `/health` → `{"status":"ok","mode":"mock","model":"claude-opus-5-5"}`; `/`, `/inbox`, `/inbox/1`, `/matters`, `/matters/1`, `/outbox`, `/activity`, `/billing`, `/portal/<seeded token>` all 200.
- Intake over the API: inquiry 1 (employment, NY) → `accept`, reply proposes Tue Nov 17 10:00 and Thu Nov 19 15:00, engagement-letter approval created; inquiry 3 (DUI) → `decline` citing `decline_area`, reply includes the bar-referral line and "This email is not legal advice"; inquiry 2 (adverse party Northwind Logistics) → `needs_lawyer`, conflict score 100 against existing client; inquiry 7 (Crestline Holdings as prospective client) → `needs_lawyer`, matched the adverse party on an existing matter; inquiry 6 (vague) → `needs_lawyer` (unknown jurisdiction).
- Rejected the reply with a reason, re-ran intake: the reason appears in the next `draft_reply` system prompt (`agent_runs.prompt`).
- Approved the engagement letter → client 6 + matter 4 (`engagement_sent`), `data/letters/4.docx` (29 paragraphs, reopens with python-docx) and `4.md`.
- Portal sign → `onboarding`, 7 checklist rows (5 template + 2 extras), `document_request` approval. Uploads of a txt ID: other name → `mismatch`; `EXPIRES: 2020-01-01` → `expired`; client name + 2031 expiry → `verified`.
- Advance 4 days + run daily → 3 chasers + 1 payment reminder (seeded overdue invoice); second run same day → nothing new.
- Generate invoice on matter 1 → `HV-2026-002`, subtotal $2,712.50 (= Σ minutes/60 × rate), `invoice_email` approval; approved → `sent`; +38 days → reminder stage 1, +7 → stage 2, re-run → no duplicate; portal pay → `paid`, portal shows "Paid".
- `outbox` rows == approved approvals (2 == 2) at the end of the walkthrough; `send_mail` in `app/agents.py` is the only outbox writer and is called only from `approve()`.
- Screenshots of `/`, `/portal/<token>` and `/inbox/1` looked right (approval cards with editable draft + rationale, portal status bar + checklist, pipeline steps).
- Known quirks (documented in README): chasers are drafted even before the first document request is approved; the seeded 20-days-overdue invoice jumps straight to reminder stage 2; portal links in drafts use `PORT`/`PUBLIC_BASE_URL`, not the port the server was actually started on. The live Anthropic path was not run (no key in the sandbox).
- Server stopped; `data/`, `.pytest_cache` and `__pycache__` removed; `.venv/` ignored.

## Fable (main agent) work — rough estimate, exact counters not visible
Research (6 searches, ~14 fetches), spec, prompt, review (tests, server walkthrough, 3 screenshots), doc, architecture page and posts: ~160k fresh input, ~3.5M cached input reads, ~55k output tokens.

## Cost estimate (prices fetched 2026-11-16 from https://platform.claude.com/docs/en/about-claude/pricing)
| Model | Role | Tokens | Price used | Estimate |
|-------|------|--------|-----------|----------|
| Claude Sonnet 5.5 (`sonnet` alias) | build (subagent) | 149,584 total, assumed 80/20 in/out: 119.7k in / 29.9k out | $2 / MTok in, $10 / MTok out | **~$0.54** |
| Claude Sonnet 5.5 — upper bound from raw transcript usage | build (subagent) | 290k cache-write, 3.08M cache-read, 200k out | $2.50 cache-write, $0.10 cache-read, $10 out per MTok | ~$3.04 |
| Claude Fable 5.1 | research, review, docs (main agent) | ~160k in, ~3.5M cache-read, ~55k out | $10 / MTok in, $0.25 cache-read, $50 / MTok out | **~$5.23** |
| **Total** | | | | **~$5.77** (headline) to ~$8.3 (if the upper-bound build figure is right) |

All figures are estimates. The Fable numbers are a rough count because this session does not expose its own token counters.
