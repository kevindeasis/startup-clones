# Lantern-lite: a self-hosted clone of Lantern AI

> This folder was built by an AI agent (Claude) from a written build spec (`SPEC.md`, 2026-11-02). It has been run and smoke-tested in mock-LLM mode only; it has **not** been exercised against the real Anthropic API.

## The original company

[Lantern AI](https://www.lantern.md) ([YC F26 profile](https://www.ycombinator.com/companies/lantern-ai)) is an AI recruiting platform ("Turn your taste into hires"). It captures a team's hiring bar in a **Company Hiring Model** (criteria, interview feedback, past decisions) and runs recruiting agents on top of it: sourcing, application review (gaps flagged as open questions, not proof), AI interviews, meeting intelligence and hiring analytics. Approved decisions feed back into the model. Humans make the final call.

## What this clone does

The thin LLM core of that loop:

> define the hiring bar -> review applications against it -> record decisions with reasons -> the bar learns from decisions -> ask questions about the pipeline.

1. **Role + hiring bar**: paste a JD, the LLM drafts 4-8 weighted criteria (must_have / nice_to_have / dealbreaker); edit and save as Hiring Model v1.
2. **Application review**: upload PDF/.txt resumes or paste text; per-criterion score 0-5, evidence, confidence, open questions, summary, recommendation. `overall_score` is computed in code (Σ score·weight / Σ 5·weight × 100); a dealbreaker scoring 0 forces `reject`.
3. **Decide and teach**: Advance/Reject with a reason; "Update hiring model from decisions" proposes vN+1 (needs at least 2 decisions), shown as a diff with Approve/Discard; "Re-review all" re-scores against the latest approved model.
4. **Interview plan**: 6-10 targeted questions from open questions and lowest-confidence criteria.
5. **Ask the pipeline**: streamed markdown chat over a computed pipeline-summary JSON, with a "pattern alone does not prove a cause" caveat.

**Skipped** (per spec): auth, billing, teams, ATS integrations, email, sourcing, voice/video AI interviews, meeting intelligence, charts, deployment config.

## Architecture

- **Next.js 15** App Router (TypeScript, `src/`): server-rendered pages read SQLite directly; small client components call JSON route handlers under `src/app/api`.
- **Storage**: Node's built-in `node:sqlite` (`DatabaseSync`), file `./data/lantern.db`, tables created on first use. **node:sqlite worked inside Next route handlers; the `better-sqlite3` fallback was not needed.** It is loaded via `process.getBuiltinModule('node:sqlite')` to dodge bundler resolution issues. Node prints an ExperimentalWarning; that is expected.
- **LLM**: Vercel AI SDK. Structured output uses **`generateObject({ model, schema, system, prompt })`** (present in `ai@7.0.159`) with Zod schemas; the analytics chat uses **`streamText(...).toTextStreamResponse()`**. One module per task in `src/lib/ai/` (`draftRubric`, `reviewCandidate`, `proposeModelUpdate`, `interviewPlan`, `askPipeline`), plus `src/lib/ai/mock.ts`.
- **Mock mode**: active when `MOCK_LLM=1` or `ANTHROPIC_API_KEY` is empty. Deterministic keyword-overlap scoring, canned plans and templated analytics answers; a yellow banner shows in the UI.
- **PDF**: `unpdf` (`getDocumentProxy` + `extractText`). **Styling**: Tailwind v4. **Markdown**: `react-markdown`.
- `src/lib/repo.ts` holds all DB access and the review/summary logic; `src/lib/score.ts` the scoring math.

Note on versioning: proposals take `max(version)+1`, so a discarded proposal leaves a gap in version numbers. The initial AI-drafted rubric is stored as a `proposed` v1 row until you save it on the setup screen.

## GitHub tools used

| Package | Repo | Used for |
|---|---|---|
| next 15 | https://github.com/vercel/next.js | App framework, API routes |
| ai, @ai-sdk/anthropic | https://github.com/vercel/ai | LLM calls, structured output, streaming |
| zod | https://github.com/colinhacks/zod | Schemas / validation |
| unpdf | https://github.com/unjs/unpdf | PDF to text |
| tailwindcss | https://github.com/tailwindlabs/tailwindcss | Styling |
| react-markdown | https://github.com/remarkjs/react-markdown | Render LLM markdown |
| pdfkit (dev only) | https://github.com/foliojs/pdfkit | Generate a PDF in the smoke test |
| node:sqlite | https://github.com/nodejs/node | Storage (built in) |

## Setup and run

Requires Node >= 22.13 (built and tested on v22.23.4, npm 10.9.9).

```bash
npm install
cp .env.example .env.local     # optional; add ANTHROPIC_API_KEY for real LLM calls
npm run dev                    # http://localhost:3000   (or: npm run build && npm start)
```

Quick demo: create a role with `samples/jd-senior-backend.md`, save the drafted criteria, upload the three `samples/resume-*.txt` files, record an Advance and a Reject with reasons, click "Update hiring model from decisions", approve, then ask "Who are my top 3 and why?". All sample people are fictional.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Real LLM calls; empty means mock mode |
| `LLM_MODEL` | Anthropic model id, default `claude-sonnet-5-5` |
| `MOCK_LLM` | `1` forces mock mode even with a key |
| `DATABASE_PATH` | SQLite file, default `./data/lantern.db` |

## Verification (what was actually run)

```bash
npm install
MOCK_LLM=1 npm run build        # compiled successfully, type check passed, all routes built
MOCK_LLM=1 npm run dev &        # booted; GET / returned 200
npm run smoke                   # exit code 0
```

`npm run smoke` output (against the dev server, fresh database):

```
    
    > lantern-lite@0.1.0 smoke
    > node scripts/smoke.mjs
    
    PASS  GET / returns 200 with roles UI
    PASS  Mock LLM banner visible
    PASS  POST /api/roles returns role + 4-8 criteria - 6 criteria
    PASS  Save creates Hiring Model v1 (approved)
    PASS  3 txt candidates + 1 PDF candidate created - Alice Nguyen (fictional), Bob Okafor (fictional), Carla Mendes (fictional), Alice Pdf (fictional)
    PASS  PDF text was extracted
    PASS  Each review has per-criterion scores, >=1 open question, 0-100 score, recommendation - Alice Nguyen (fictional):68.9/advance | Bob Okafor (fictional):40/hold | Carla Mendes (fictional):0/reject | Alice Pdf (fictional):68.9/advance
    PASS  Two decisions recorded
    PASS  Propose refuses with <2 decisions (unchanged, "Not enough decisions yet")
    PASS  Propose creates proposed v2 with change_summary - [mock] Based on 2 decisions (1 advance, 1 reject). Weight of "Strong PostgreSQL 
    PASS  Approve makes v2 the latest approved model
    PASS  Re-review produces new reviews referencing v2
    PASS  Interview plan has 6-10 questions referencing known criteria - 6 questions
    PASS  Ask streams a non-empty answer - "**Top candidates (mock answer)**\n\n1. **Alice Nguyen (fiction"
    PASS  Both messages persisted
    PASS  GET summary returns pipeline JSON
    PASS  GET /roles/:id renders
    PASS  GET /roles/:id/model renders
    PASS  GET /roles/:id/candidates/:id renders
    PASS  Invalid input rejected with 400
    
    All smoke checks passed
```

The smoke script generates a PDF from a sample resume with pdfkit and uploads it, so PDF extraction is covered. The dev server was stopped afterwards.

## Known limitations

- Never run against the real Anthropic API; prompts and the `generateObject` schemas (e.g. min/max array constraints) are untested live and may need tuning for provider schema limits.
- Mock scoring is naive keyword overlap; its output is plausible-looking, not meaningful.
- Reviews and re-reviews run sequentially inside one HTTP request (fine for a handful of resumes; no job queue).
- No auth, no rate limiting, resume text is stored unredacted in SQLite.
- Dev-mode quirk: the webpack watcher ignores `data/` (see `next.config.ts`); otherwise every DB write triggers a recompile that can 500 in-flight requests.
- Scanned (image-only) PDFs produce no text and are rejected.
- Discarded proposals leave version-number gaps; only the latest approved model is used.

## Next 3 things to build

1. Background job queue plus progress UI for bulk resume uploads and re-review, with cost/token tracking.
2. Feed richer signal into the hiring model: interview feedback and scorecards, plus an eval harness that measures how well each model version predicts past decisions.
3. ATS import (Greenhouse/Lever webhooks) and email intake for applications, then a sourcing agent over public profiles.
