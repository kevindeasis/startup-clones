# Build spec — Lantern AI clone ("Lantern-lite")

Date: 2026-11-02 · Original company: Lantern AI (YC F26) · https://www.lantern.md · https://www.ycombinator.com/companies/lantern-ai

## 1. What the product does

Lantern AI ("Turn your taste into hires") is an AI recruiting platform. Its pitch: hiring managers already know who they'd hire, but that taste lives in their heads. Lantern captures a team's hiring bar in a **Company Hiring Model** (criteria, interview feedback, past decisions), then uses it to run recruiting agents: talent sourcing, **application review** (checks each application against the team's criteria and flags gaps as *open questions, not proof*), AI interviews, meeting intelligence, and **hiring analytics** (plain-language questions about the pipeline). Every approved decision feeds back into the hiring model so later stages share the same context. Humans make the final decision.

This clone implements the thin, LLM-powered core of that loop as a self-hosted web app:

> **Define the hiring bar → review applications against it → record decisions with reasons → the hiring bar learns from those decisions → ask questions about the pipeline.**

Sourcing (needs external people data), live AI interviews (needs voice/video), meeting intelligence (needs call recordings) and ATS integrations are **out of scope**. See §9.

## 2. Core user flows (implement all five)

1. **Create a role with a hiring bar.** User enters a role title and pastes a job description. The LLM drafts a structured rubric: 4–8 criteria, each with `name`, `description`, `weight` (1–5), and `type` (`must_have` | `nice_to_have` | `dealbreaker`). User can edit/add/remove criteria and save. This rubric is the role's **Hiring Model v1**.
2. **Add candidates and review them.** User uploads one or more resumes (PDF or .txt) or pastes resume text. The app extracts text (PDF via `unpdf`), stores the candidate, and runs an **application review**: for each criterion the LLM returns `score` (0–5), `evidence` (short quote/paraphrase from the resume, or "none found"), and `confidence`. It also returns `open_questions[]` (gaps that should be asked about, explicitly *not* treated as disqualifiers), `summary`, `overall_score` (weighted, computed in code, not by the LLM), and `recommendation` (`advance` | `hold` | `reject`). Results display on a candidate page with the rubric side by side.
3. **Decide and teach the model.** On a candidate page the user clicks **Advance** or **Reject** and writes a short reason. The decision is stored. The user can then click **"Update hiring model from decisions"**: the LLM reads the current rubric + all decisions with reasons (and the reviews' scores) and proposes **Hiring Model vN+1**: adjusted weights, reworded criteria, and new `taste_notes[]` (free-text preferences such as "prefers candidates who shipped a product end to end over big-company titles"). The user sees a diff (old vs new) and clicks **Approve** or **Discard**. Approved versions are stored; future reviews use the latest approved version. A **Re-review all** button re-scores existing candidates against the latest model.
4. **Interview plan.** From a candidate page, **Generate interview plan**: the LLM turns the candidate's `open_questions` and lowest-confidence criteria into 6–10 targeted interview questions, each tagged with the criterion it probes and "what a strong answer sounds like". Stored and shown on the candidate page.
5. **Ask the pipeline (hiring analytics).** A chat box on the role page: the user asks plain-language questions ("Who are my top 3 and why?", "Which criterion is rejecting the most people?", "How many candidates are on hold?"). The server computes a compact pipeline summary JSON (counts by stage, per-criterion average score, per-candidate scores and decisions, model version history) and passes it to the LLM with the question; the LLM answers in markdown with a one-line caveat when it infers causes ("a pattern alone does not prove a cause" — mirrors Lantern's own wording). Streams the answer.

## 3. Stack

- **Next.js 15** (App Router, TypeScript, `src/` directory) — UI + API route handlers. Pin `next@15` (not 16) for stability.
- **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`) — all LLM calls. Default model `claude-sonnet-5-5` configurable via env. Use structured output (`generateObject` if present in the installed `ai` version; otherwise `generateText` with `Output.object`/`experimental_output` — check `node_modules/ai/dist/index.d.ts` before writing code) with **Zod** schemas. Use `streamText` for the analytics chat.
- **Zod** — schemas for every LLM output and every API input.
- **SQLite via Node's built-in `node:sqlite`** (`DatabaseSync`; Node ≥ 22.13, available unflagged in the Node 22.23 installed here). Zero native deps. Database file at `./data/lantern.db` (gitignored), created on first run with `CREATE TABLE IF NOT EXISTS`. If `node:sqlite` cannot be imported inside Next route handlers, add `serverExternalPackages` config; if that still fails, fall back to `better-sqlite3`. Document whichever was used in the README.
- **unpdf** — PDF text extraction (pure JS, no native deps).
- **Tailwind CSS v4** — styling (via `@tailwindcss/postcss`). Minimal, clean UI; no component library required.
- **react-markdown** — render LLM markdown answers.
- No auth, no billing, no multi-tenant.

### Verified open-source projects to use (all exist and are active; versions from the npm registry on 2026-11-02)

| Package | Repo | Latest | Used for |
|---|---|---|---|
| `next` | https://github.com/vercel/next.js | 16.4.3 (use 15.x) | App framework, API routes |
| `ai`, `@ai-sdk/anthropic` | https://github.com/vercel/ai | 7.0.159 / 4.0.94 | LLM calls, structured output, streaming |
| `zod` | https://github.com/colinhacks/zod | 4.6.7 | Schemas |
| `unpdf` | https://github.com/unjs/unpdf | 2.1.0 | PDF → text |
| `tailwindcss` | https://github.com/tailwindlabs/tailwindcss | 4.3.3 | Styling |
| `node:sqlite` | Node.js core | built in | Storage |
| (fallback) `better-sqlite3` | https://github.com/WiseLibs/better-sqlite3 | 13.0.3 | Storage if node:sqlite fails |

Do not add other LLM frameworks (no LangChain/LlamaIndex) — the pipeline is small enough for the AI SDK alone.

## 4. Data model (SQLite)

```sql
roles(id TEXT PK, title TEXT, job_description TEXT, created_at TEXT)
hiring_models(id TEXT PK, role_id TEXT FK, version INTEGER, status TEXT /* 'approved'|'proposed'|'discarded' */,
              criteria_json TEXT, taste_notes_json TEXT, change_summary TEXT, created_at TEXT)
candidates(id TEXT PK, role_id TEXT FK, name TEXT, source_filename TEXT, resume_text TEXT, created_at TEXT)
reviews(id TEXT PK, candidate_id TEXT FK, hiring_model_id TEXT FK, overall_score REAL, recommendation TEXT,
        summary TEXT, criteria_scores_json TEXT, open_questions_json TEXT, created_at TEXT)
decisions(id TEXT PK, candidate_id TEXT FK, decision TEXT /* 'advance'|'reject' */, reason TEXT, created_at TEXT)
interview_plans(id TEXT PK, candidate_id TEXT FK, questions_json TEXT, created_at TEXT)
analytics_messages(id TEXT PK, role_id TEXT FK, role TEXT /* 'user'|'assistant' */, content TEXT, created_at TEXT)
```

Criteria JSON shape: `{ id, name, description, weight: 1-5, type: 'must_have'|'nice_to_have'|'dealbreaker' }[]`.
`overall_score` = Σ(score × weight) / Σ(5 × weight) × 100, computed in TypeScript. If any `dealbreaker` criterion scores 0, recommendation defaults to `reject` regardless of LLM output (LLM output is still shown).

A candidate's **current review** is the latest review whose `hiring_model_id` is the latest approved model (or the latest review if none).

## 5. Screens and endpoints

Screens (App Router pages):
- `/` — list of roles + "New role" form (title + JD) → POST creates role and redirects to `/roles/[id]/setup`.
- `/roles/[id]/setup` — shows LLM-drafted rubric; editable table; Save → Hiring Model v1 (approved).
- `/roles/[id]` — role dashboard: pipeline table (candidate, overall score, recommendation, decision, model version reviewed against), upload/paste candidates panel, "Update hiring model from decisions", "Re-review all", current hiring model (criteria + taste notes, version), and the **Ask the pipeline** chat.
- `/roles/[id]/candidates/[cid]` — candidate page: resume text (collapsible), review (per-criterion scores with evidence + confidence, open questions, summary, recommendation), Advance/Reject with reason, Generate interview plan, interview plan.
- `/roles/[id]/model` — hiring model history (all versions, status, change summaries) and the pending proposal diff with Approve/Discard.

API route handlers (`src/app/api/...`), all JSON, all inputs validated with Zod:
- `POST /api/roles` `{title, job_description}` → `{role, draft_criteria}` (calls LLM to draft rubric)
- `POST /api/roles/[id]/model` `{criteria}` → saves approved model v1 (or when `proposal_id` given: approve/discard a proposal)
- `POST /api/roles/[id]/model/propose` → runs the learning step, stores a `proposed` model, returns `{proposal, previous}`
- `POST /api/roles/[id]/candidates` multipart (files[]) or JSON `{name?, resume_text}` → extracts text, stores candidate(s), runs review for each → returns candidates with reviews
- `POST /api/roles/[id]/rereview` → re-reviews all candidates against latest approved model
- `POST /api/candidates/[cid]/decision` `{decision, reason}`
- `POST /api/candidates/[cid]/interview-plan` → generates and stores plan
- `POST /api/roles/[id]/ask` `{question}` → streamed text response (AI SDK `streamText` → `toTextStreamResponse()`); persist user + assistant messages
- `GET /api/roles/[id]/summary` → the pipeline summary JSON used by analytics (also handy for debugging)

## 6. LLM pipeline design

One module `src/lib/llm.ts` exports the provider/model and a `MOCK_LLM` switch. One module per task in `src/lib/ai/`:

- `draftRubric(jobDescription)` — system prompt: "You are a senior recruiter turning a job description into a scoring rubric…"; output Zod schema `{criteria: Criterion[]}`; 4–8 criteria; must label at least one `must_have`; weights 1–5.
- `reviewCandidate(resumeText, model)` — system prompt includes the rubric and taste notes verbatim and these rules: cite evidence from the resume only; never infer protected characteristics (age, gender, ethnicity, religion, disability, family status) and ignore them if present; when evidence is missing, score low **and** add an open question rather than assuming the worst; output `{criteria_scores: {criterion_id, score 0-5, evidence, confidence 'low'|'medium'|'high'}[], open_questions: string[], summary, recommendation}`.
- `proposeModelUpdate(model, decisionsWithReviews)` — system prompt: "You maintain a team's hiring model. Given the current rubric, taste notes, and the team's advance/reject decisions with reasons, propose a revised model that better predicts their decisions. Change as little as needed; explain each change."; output `{criteria, taste_notes, change_summary}`. Refuse (return unchanged + change_summary "Not enough decisions yet") if fewer than 2 decisions — enforce in code too.
- `interviewPlan(candidateReview, model)` — output `{questions: {question, probes_criterion_id, strong_answer_looks_like}[]}`, 6–10 items.
- `askPipeline(question, summaryJson, history)` — `streamText`; system prompt includes the summary JSON and the rule: "If you infer a cause from a pattern, say that a pattern alone does not prove a cause."

**Mock mode:** when `MOCK_LLM=1` or `ANTHROPIC_API_KEY` is unset, every function returns deterministic, schema-valid fake output derived from the inputs (e.g. rubric from JD keywords, scores from keyword overlap between criterion names and resume text, canned interview questions, a templated analytics answer). The UI must show a visible "Mock LLM mode" banner. This is how the build is verified in this session (no API key is available here).

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real reviews; leave empty to run in mock mode
LLM_MODEL=claude-sonnet-5-5   # any Anthropic model id supported by @ai-sdk/anthropic
MOCK_LLM=                     # set to 1 to force mock mode even with a key
DATABASE_PATH=./data/lantern.db
```

## 8. What to skip

Auth, billing, multi-user/teams, ATS integrations, email, candidate sourcing, AI voice/video interviews, meeting transcription, charts (text answers are enough), deployment config. Keep seed data: ship `samples/` with one job description (`samples/jd-senior-backend.md`) and three fake resumes as `.txt` (clearly fictional names, no real people) so the main flow can be exercised in one minute.

## 9. Acceptance checks (the build must pass all of these)

1. `npm install` and `npm run build` succeed with no type errors.
2. `npm run dev` (or `npm start` after build) boots; `GET /` returns 200 and renders the roles list.
3. With `MOCK_LLM=1`: `POST /api/roles` with the sample JD returns a role and 4–8 draft criteria; saving them creates hiring model v1 (approved).
4. Uploading the three sample `.txt` resumes (and at least one PDF generated from one of them during verification) creates three candidates with reviews; each review has a score per criterion, ≥1 open question, an overall score 0–100 and a recommendation.
5. Recording two decisions with reasons and calling `POST /api/roles/[id]/model/propose` creates a `proposed` v2 with a non-empty `change_summary`; approving it makes v2 the latest approved model; `rereview` produces new reviews referencing v2.
6. `POST /api/candidates/[cid]/interview-plan` returns 6–10 questions each referencing a criterion id present in the model.
7. `POST /api/roles/[id]/ask` streams a non-empty answer and persists both messages.
8. A short script `scripts/smoke.mjs` runs checks 3–7 against a running dev server (fetch calls) and exits 0; `npm run smoke` runs it. Its output is pasted into the README's "Verification" section.
9. `.env.example` and `.gitignore` present; no `.env`, `node_modules`, `.next`, or `data/*.db` committed.
10. README covers everything listed in the build instructions.
