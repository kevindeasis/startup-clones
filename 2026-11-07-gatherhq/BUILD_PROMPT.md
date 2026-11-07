# BUILD_PROMPT.md — prompts sent to the build subagent (verbatim, in order)

## Round 1 — initial build prompt (Agent tool, subagent_type general-purpose, model sonnet)

```
You are building a working clone of the YC F26 startup GatherHQ inside the folder `/home/claude/startup-clone/2026-11-07-gatherhq/` (it already contains SPEC.md, BUILD_PROMPT.md and BUILD_LOG.md — leave those files alone). Build exactly per the spec below.

Instructions:
- Build the working end-to-end clone inside `/home/claude/startup-clone/2026-11-07-gatherhq/` exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them. Scaffold Next.js directly in that folder (e.g. run `npx create-next-app@latest` into a temp dir and move the files in, or scaffold in place with `.` — the folder must end up as the project root containing package.json).
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO ANTHROPIC_API_KEY in this environment, so you must implement and verify everything in MOCK_LLM=1 mode (see spec section 7). Still write the real Anthropic code path using the Vercel AI SDK so it works when a key is present.
- Add a `.gitignore` appropriate for the stack (node_modules, .env, .next, build output, data/*.db, venv, __pycache__).
- Verify it: install dependencies, run `npm run build`, run any tests, and start the app locally (`npm run dev` on port 3000 in the background, wait for "Ready") to confirm it boots and the main flow works. Run the smoke script (acceptance checks A3–A9) against the running server and fix every failure before finishing. Do not claim it works unless you actually ran it. Kill the dev server when done.
- Write a thorough `README.md` in the folder: what the original company does (with link https://gatherhq.com and the YC launch page), what this clone does and what it skips, architecture summary, the GitHub tools used (with links), exact setup and run steps, environment variables, mock mode, known limitations, and the next 3 things to build. Note that the clone was specified by Claude Fable 5.1 and built by a Claude Sonnet subagent on 2026-11-07.
- Do not modify anything outside that folder. Do not commit or push. Do not run `git` commands at all.
- Network note: GitHub API/raw downloads may be blocked for native prebuilds; `npm install better-sqlite3` has been tested and works here. If any package fails to install, pick the closest alternative and note it in the README.
- Report back in your final message: (1) what was built (file tree summary), (2) exactly which verification commands were run and their results including the smoke script output, (3) anything that does not work or deviates from the spec, (4) your total input and output token usage as best you can report it.

=== SPEC.md (verbatim) ===
# Build spec — GatherHQ clone ("Gatherlite")

Date: 2026-11-07
Original company: GatherHQ (YC F26) — https://gatherhq.com — launch post: https://www.ycombinator.com/launches/WI6-gatherhq-an-api-for-how-buyers-think-built-for-agents-and-teams

## 1. What the product does

GatherHQ calls itself "an API for how buyers think." A marketing/product/insights team
tells it what they want to learn about their buyers. An AI researcher designs a study,
conducts adaptive interviews with real participants, stores everything that is learned, and
maintains a "living buyer model" that the team (via web app / Slack) and their agents (via
API/MCP) can query. The buyer model can also be used to *simulate* how buyers would react to
a pricing change, a message, or a product idea, and the research can be turned into content
(reports, social posts).

This clone implements the core loop end to end, locally, with one LLM provider:

1. Create a **study** (goal + target audience + optional seed questions).
2. The AI generates an **interview guide** (5–8 open questions).
3. **Interviews**: a shareable link opens a chat where a participant is interviewed by the AI,
   which asks the guide questions and adaptive follow-ups. A **"Run synthetic panel"** button
   generates N synthetic participants (AI-played personas) so the pipeline can be exercised
   without real humans.
4. After interviews complete, **Synthesize**: the AI produces the study's **buyer model**
   (key themes, objections, jobs-to-be-done, segments, verbatim quotes with citations to
   interview IDs).
5. **Ask the buyer model** (chat): grounded Q&A over interview transcripts (lexical retrieval
   with MiniSearch + LLM synthesis, with citations).
6. **Simulate**: paste a message / pricing / idea; the model returns predicted reactions from
   3–5 persona segments, clearly labeled "illustrative buyer model — not real quotes."
7. **Export**: generate a Markdown report for the study; a JSON API exposes the model so
   agents can query it.

## 2. Core user flows to implement (all required)

F1. Create study → AI drafts interview guide → user can edit questions → save.
F2. Interview: `/interview/[token]` chat. AI greets, asks questions one at a time, asks one
    follow-up when an answer is short/vague, thanks and marks interview complete. Transcript
    saved per message. Also: "Run synthetic panel" (N=3 default, max 8) generates personas
    and runs the interview with the AI playing both sides (server-side loop, max 10 turns).
F3. Synthesize → buyer model stored as JSON + rendered on the study page (themes, objections,
    segments, quotes with `[int:<id>]` citations).
F4. Ask the model: chat over the study's transcripts (retrieval → prompt with top-k chunks →
    answer with citations). Also exposed as `POST /api/studies/[id]/ask` for agents.
F5. Simulate reactions: `POST /api/studies/[id]/simulate` with `{ stimulus }` → structured
    list of `{ segment, reaction, sentiment (-2..2), likely_objection, quote_style_example }`.
    UI on the study page.
F6 (small). Export Markdown report at `GET /api/studies/[id]/report` (download button).

## 3. Stack

- **Next.js 15/16 (App Router) + TypeScript**, Tailwind CSS. `npx create-next-app@latest`
  with `--ts --tailwind --app --src-dir --eslint --no-import-alias` style defaults is fine.
- **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`): `generateText`, `generateObject`
  (zod schemas), `streamText` for chat. Use the latest published versions and check the
  installed package's `.d.ts` for the exact API before writing code (option names like
  `maxOutputTokens`). Keep the client simple: call route handlers with `fetch` and render the
  response or the streamed text; do NOT depend on `useChat` if its API is uncertain.
- **better-sqlite3** for storage (single file `data/gatherlite.db`, created on first run via
  `schema.sql` executed in `src/lib/db.ts`). Add `data/*.db` to `.gitignore`.
- **MiniSearch** (`minisearch`) for in-memory lexical retrieval over transcript chunks (built
  per study on demand; chunk = one Q/A pair).
- **zod** for schemas (generateObject + request validation).
- **nanoid** for tokens/ids (or `crypto.randomUUID()`).

No vector DB, no embeddings (Anthropic has no embeddings API; keep it key-free). No auth,
no billing, no Slack, no recruiting panel, no real-participant payouts, no MCP server.

## 4. Open-source libraries and what each covers

| Library | Repo | Covers |
|---|---|---|
| Next.js | https://github.com/vercel/next.js | app, routing, API route handlers, UI |
| Vercel AI SDK (`ai`, `@ai-sdk/anthropic`) | https://github.com/vercel/ai | all LLM calls, structured output, streaming |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | persistence |
| MiniSearch | https://github.com/lucaong/minisearch | retrieval for "Ask the model" |
| zod | https://github.com/colinhacks/zod | schemas |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss | styling |

## 5. Data model (SQLite)

```
studies(id TEXT PK, title, goal, audience, status TEXT DEFAULT 'draft', created_at)
questions(id TEXT PK, study_id FK, position INT, text)
interviews(id TEXT PK, study_id FK, token TEXT UNIQUE, participant_name, persona TEXT NULL,
           synthetic INT DEFAULT 0, status TEXT DEFAULT 'in_progress', created_at, completed_at)
messages(id TEXT PK, interview_id FK, role TEXT ('assistant'|'user'), content TEXT, created_at)
buyer_models(id TEXT PK, study_id FK, version INT, model_json TEXT, created_at)
```

## 6. Screens and endpoints

Pages:
- `/` — list studies + "New study" form (title, goal, audience, optional seed questions).
- `/studies/[id]` — study dashboard: questions (editable), interviews table (status, link,
  synthetic badge), buttons: Copy interview link, Run synthetic panel, Synthesize, Download
  report; tabs/sections: Buyer model, Ask the model (chat), Simulate.
- `/interview/[token]` — participant chat UI (no login).

API (JSON):
- `POST /api/studies` → create study, generate guide via LLM, return study.
- `GET /api/studies/[id]` → study + questions + interviews + latest model.
- `PUT /api/studies/[id]/questions` → replace questions.
- `POST /api/studies/[id]/interviews` → create interview (returns token + URL).
- `POST /api/interviews/[token]/messages` → `{ content }` from participant → returns next
  assistant message and `done: boolean`. First call with empty body returns the greeting.
- `POST /api/studies/[id]/synthetic` → `{ n }` → generates personas and runs interviews.
- `POST /api/studies/[id]/synthesize` → builds and stores buyer model.
- `POST /api/studies/[id]/ask` → `{ question }` → `{ answer, citations: [...] }`.
- `POST /api/studies/[id]/simulate` → `{ stimulus }` → structured reactions.
- `GET /api/studies/[id]/report` → `text/markdown` download.

## 7. LLM pipeline / prompt design

Provider: `anthropic('claude-sonnet-4-5')` by default; model id from `ANTHROPIC_MODEL` env.
Put all prompts in `src/lib/prompts.ts`. Put all LLM calls behind `src/lib/llm.ts`.

- **Guide generation** (`generateObject`): system = "You are a senior UX/market researcher…";
  input = goal + audience + seed questions; output zod `{ questions: string[] (5–8) }`.
  Questions must be open-ended, non-leading, ordered warm-up → core → wrap-up.
- **Interviewer turn** (`generateText`): system includes the guide, which questions are
  already covered (derived from transcript length / a `covered` list stored in the latest
  assistant message metadata or recomputed by counting assistant questions), rules: one
  question per turn, ≤1 follow-up per guide question, plain conversational tone, never give
  opinions. Return `[DONE]` sentinel when all questions are covered → mark complete and send
  a thank-you message.
- **Synthetic panel**: `generateObject` → `{ personas: {name, role, context, attitude}[] }`;
  then for each persona loop: interviewer turn → `generateText` persona answer (system =
  persona card, 2–4 sentences, realistic, specific, sometimes skeptical) until `[DONE]` or
  10 turns.
- **Synthesis** (`generateObject`): input = all completed transcripts labeled with interview
  ids; output zod:
  `{ summary, themes: {title, description, evidence: {interview_id, quote}[]}[],
     objections: string[], jobs_to_be_done: string[], segments: {name, description,
     share_estimate}[], recommended_messages: string[] }`.
- **Ask**: MiniSearch over chunks `{ id, interview_id, participant, text: Q + "\n" + A }`
  (fuzzy 0.2, prefix true), top 8 → prompt "Answer only from the excerpts; cite as
  [int:<interview_id>]; say what is not covered." Return answer + the cited chunks.
- **Simulate** (`generateObject`): input = latest buyer model JSON + stimulus; output array
  of segment reactions as in F5. UI must display the disclaimer "Illustrative buyer model —
  simulated, not real quotes."

### Mock mode (required for verification without a key)
If `MOCK_LLM=1` or `ANTHROPIC_API_KEY` is missing, `src/lib/llm.ts` must return deterministic
fake outputs for every call shape (guide, interviewer turn, persona, synthesis, ask,
simulate) so that every flow completes end to end. Mock interviewer turn: ask the next guide
question verbatim, return `[DONE]` after the last. Log a one-line warning to the server
console when mock mode is active and show a small "Mock LLM mode" badge in the UI header.

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real LLM output
ANTHROPIC_MODEL=claude-sonnet-4-5
MOCK_LLM=                     # set to 1 to force mock mode
DATABASE_PATH=./data/gatherlite.db
NEXT_PUBLIC_BASE_URL=http://localhost:3000
```

## 9. Out of scope (skip)

Auth, teams, billing, Slack bot ("Emma"), participant recruiting / incentives, real panel of
65M people, MCP server, content generation beyond the Markdown report, vector embeddings,
deployment config.

## 10. Acceptance checks (the build must pass these; run them in MOCK_LLM=1)

A1. `npm install && npm run build` succeed with zero TypeScript errors.
A2. `npm run dev` (or `npm start`) boots; `GET /` returns 200 and shows the studies list.
A3. `curl -X POST /api/studies` with `{title, goal, audience}` returns a study with 5–8
    questions persisted in SQLite.
A4. `POST /api/studies/[id]/interviews` returns a token; `/interview/[token]` renders;
    posting 3+ messages to `/api/interviews/[token]/messages` advances through the guide and
    eventually returns `done: true`, and the interview status becomes `complete`.
A5. `POST /api/studies/[id]/synthetic` with `{n: 2}` creates 2 completed synthetic interviews
    with ≥6 messages each.
A6. `POST /api/studies/[id]/synthesize` stores a buyer model and `GET /api/studies/[id]`
    returns it; the study page renders themes/segments.
A7. `POST /api/studies/[id]/ask` returns an answer with ≥1 citation referencing a real
    interview id.
A8. `POST /api/studies/[id]/simulate` returns ≥3 segment reactions with sentiment ints.
A9. `GET /api/studies/[id]/report` returns Markdown containing the study title.
A10. A script `scripts/smoke.sh` (or `npm run smoke`) runs A3–A9 against a running dev
     server and prints PASS/FAIL per check. Include its output in the final report.
```
