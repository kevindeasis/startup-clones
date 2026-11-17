# Build log — 2026-11-17 Elithia clone ("Chronolog")

## Pick
Elithia (YC F26; https://elithia.com; https://www.ycombinator.com/companies/elithia) — "Agents for the medical review behind every claim": paginates messy medical records (blank/duplicate removal, sorting, dating), builds a cited chronology of clinical events, human-in-the-loop verification, branded Word/PDF export.
Candidates considered and skipped today: Constor (construction takeoffs from drawings — computer vision heavy), Grep AI (broad managed-agent platform, 300+ skills), Rezora IO (voice agents for home services — overlaps Fleety), Trepo (grocery agent — needs retailer integrations), Quivly AI (onboarding/renewal agents — thin public description), Lark (distributor workflows — overlaps Asakana), Wondersearch (search infra). Previously cloned companies excluded by folder name and artifact list.
Sources: ycombinator.com/companies/elithia and elithia.com (both reachable via WebFetch); news.ycombinator.com/launches (reachable; no Launch HN for Elithia yet); techstartupslist.com and lemstudio.co F26 lists; search snippets of the founder's LinkedIn (not fetched). No independent press coverage found; traction figures are self-reported.

## Pricing (fetched 2026-11-17 from https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 5.5: $2 / MTok input, $2.50 5m cache write, $0.10 cache read, $10 / MTok output. Newest Sonnet listed; the Agent tool's "sonnet" alias is assumed to resolve to it.
- Claude Fable 5.1 (this agent): $10 / MTok input, $12.50 cache write, $0.25 cache read, $50 / MTok output.
- Model IDs confirmed from the models overview page: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-5-5, claude-fable-5-2.

## Subagent calls
| # | Model | Purpose | Tokens (subagent_tokens as reported) | Notes |
|---|-------|---------|--------------------------------------|-------|
| 1 | sonnet (alias assumed → Claude Sonnet 5.5) | Build Chronolog end to end (app, 26 tests, README) per SPEC.md + BUILD_PROMPT.md | **132,428 total** (`subagent_tokens` from the Agent tool result; no input/output split reported). 18 tool uses, ~8.0 min. | Transcript metadata summed per API call (19 calls, model `claude-sonnet-5-5`): 37 fresh input, 130,151 cache-write, 1,491,274 cache-read, 74,432 output tokens. The subagent's own guess was ~65k in / ~33k out. |

Fix rounds: **0** (one cosmetic CSS line — `overflow-wrap:anywhere` on thumbnail captions — applied by the main agent after review; no subagent fix prompt was needed).

## Fable review (main agent), 2026-11-17 06:13–06:16 UTC
- `pytest -q` with `env -u ANTHROPIC_API_KEY` → 26 passed (2.0 s).
- Booted `uvicorn app.main:app --port 8017` with no key: `/health` → `{"status":"ok","mode":"mock","model":"mock-heuristic"}`; `/` lists the seeded "Ellison v. St. Mary's (sample)" case.
- `POST /cases/1/paginate` → 202; status after completion: 29 pages in, 3 blanks, 3 duplicates (2 exact, 1 near-duplicate at 99 %), 11 documents in service-date order (2024-03-14 → 2024-04-10), contiguous Bates CHR-000001…CHR-000023 across the 23 kept pages, 3 classify LLM runs.
- `POST /cases/1/chronology` → 202; status: `ready`, 45 events, 15 LLM runs (3 classify + 11 extract + 1 conflict). SQL check: 0 events without a valid citation.
- Conflicts: (1) hemiarthroplasty dated 2024-03-16 in the operative report + discharge summary vs 2024-03-17 in the GP letter; (2) NKDA vs penicillin allergy across records.
- API: PATCH event 8 (summary/significance) OK; verify → `verified: true, verified_by: reviewer`; DELETE event 9 → `{"deleted":9}`; POST manual event → id 46 `created_by: user`; resolve conflict 1 → `resolved: true`.
- `GET /pages/1.png` → 200 image/png 54 KB. `export.docx` 40,663 B re-opens with python-docx (17 paragraphs, 3 tables; cover reads "Hartwell & Reyes LLP / Medical Chronology Report / Case: Ellison v. St. Mary's (sample)"). `export.pdf` 12,216 B opens in PyMuPDF with 5 pages, "Draft — pending expert sign-off" on the cover.
- Playwright screenshots of `/cases/1` (citation side panel with rendered page, extracted text and highlighted quote) and `/cases/1/pages` (document groups with thumbnails) looked right; long file names overflowed the 130 px captions → fixed with one CSS line.
- Known quirks (documented in README): same-day documents keep file order rather than time-of-day order; mock extractor is tuned to the sample bundle; live Anthropic path only covered by a stubbed-client test; `.env` must be exported, it is not auto-loaded.
- Server stopped; `data/`, `.pytest_cache` and `__pycache__` removed; `.venv/` ignored. Folder is 228 KB without the venv.

## Fable (main agent) work — rough estimate, exact counters not visible
Research (6 searches, ~12 fetches), spec, prompt, review (tests, server walkthrough, 2 screenshots), doc, architecture page and posts: ~110k fresh input, ~2.5M cached input reads, ~45k output tokens.

## Cost estimate (prices fetched 2026-11-17 from https://platform.claude.com/docs/en/about-claude/pricing)
| Model | Role | Tokens | Price used | Estimate |
|-------|------|--------|-----------|----------|
| Claude Sonnet 5.5 (`sonnet` alias) | build (subagent) | 132,428 total, assumed 80/20 in/out: 105.9k in / 26.5k out | $2 / MTok in, $10 / MTok out | **~$0.48** |
| Claude Sonnet 5.5 — upper bound from raw transcript usage | build (subagent) | 130k cache-write, 1.49M cache-read, 74k out | $2.50 cache-write, $0.10 cache-read, $10 out per MTok | ~$1.22 |
| Claude Fable 5.1 | research, review, docs (main agent) | ~110k fresh in, ~2.5M cache-read, ~45k out | $10 in, $0.25 cache-read, $50 out per MTok | **~$3.98** |
| **Total (headline)** | | | | **~$4.46** (range ~$4.5–$5.2 using the Sonnet upper bound) |

All figures are estimates: the Sonnet split is assumed, Fable counters are not exposed to the agent, and the `sonnet` alias is assumed to resolve to Claude Sonnet 5.5.
