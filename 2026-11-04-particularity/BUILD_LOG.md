# BUILD_LOG.md — Particularity clone, 2026-11-04

Run started 2026-11-04 06:10 UTC (scheduled task). Main agent: Claude Fable 5.1 (research, spec, review, docs). Builder: Claude Sonnet subagent.

## Pre-build (Fable)
- Repo check: `kevindeasis/Startup-clone` cloned (public, only an initial commit — no prior folders). No `add_repo` tool exists in this session and the session's GH_TOKEN is invalid, so push access could not be attached (see final notes).
- Previous picks skipped (from artifact list): Lantern AI, Veeza AI, Roma, Telamont, Hesper AI, Agnost AI, TesterArmy, Neomatter, Asakana.
- Research: ~14 web searches/fetches (HN Launch list, YC launches pages 0–1, extruct F26 list, Particularity YC page + site, PyPI/GitHub verification of 6 libraries).
- SPEC.md written.

## Subagent calls
| Round | Model | Purpose | Input tokens | Output tokens | Notes |
|---|---|---|---|---|---|
| 0 | claude-sonnet (Agent tool, general-purpose) | Initial build from SPEC.md | — | — | Harness reported `subagent_tokens: 96386` total (input+output not split), 19 tool uses, 341 s. Subagent could not see its own counters. Result: all 7 acceptance checks passed in its run; 8 pytest tests passed. |

## Review round 0 (Fable)
- Re-ran `pytest -q` → 8 passed. Booted uvicorn, ran acceptance checks 1–6 by curl: all pass (case with 5 evidence rows, 5 findings, complaint linked to case 1, decision → letter_pending, letter contains business + DRAFT, pages render with checklist). Screenshotted dashboard and case page: UI is clean.
- Issue found: `landing_recheck` is a page reload, not a same-page observation, so the fake-urgency check would flag any client-side countdown that restarts on reload. Requested fix round 1 (same-page timer sampling for ~6 s + keep reload capture).
