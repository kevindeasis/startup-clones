# Sona8 clone — build spec (2026-11-13)

## What the original product does
Sona8 (YC Fall 2026, https://sona8.com, YC page https://www.ycombinator.com/companies/sona8) sends
AI voice agents to interview employees about how their work actually gets done. A consulting or
transformation team picks a topic ("how does a sales quote get created?"), invites the relevant
employees, and each employee opens a link and talks to the agent for ~20 minutes in their own
language. The agent asks adaptive follow-ups ("why is that step still manual?", "who else is
involved?", "what happens when the customer is new?"). Sona8 then produces process maps, lists of
problems broken down by team/site, recommendations for optimisation/automation, and exports the
resulting workflow map so other AI tools (Claude, ChatGPT, in-house agents) can use it as context.
Buyers: consulting firms doing stakeholder interviews, enterprise transformation / corp-dev teams.

## What the clone builds ("Worktalk" — an independent learning clone, not affiliated)
A web app where a facilitator creates a **study**, invites **participants** by link, each participant
has an **adaptive interview** (text chat, with optional browser voice in/out), each finished interview
is **extracted** into a structured workflow record, and the study page **synthesises** all interviews
into a merged process map (Mermaid flowchart), a pain-point table grouped by team/site, automation
recommendations, and an **agent-readable context export** (Markdown + JSON).

## Stack (fixed)
- Next.js 16 (App Router) + TypeScript, `npm`. Create it with `npx create-next-app@latest . --ts --app --eslint --tailwind --src-dir --no-import-alias --use-npm` (or hand-write the equivalent) inside the project folder.
- Vercel AI SDK: `ai` (v7.x), `@ai-sdk/anthropic` (v4.x), `@ai-sdk/react` (v4.x). Use `streamText` for interview turns and structured-object generation (`generateObject` or `generateText` + `Output.object` — check the installed version's exported API in `node_modules/ai/dist/index.d.ts` before writing code and use whichever exists) for extraction and synthesis. Default model id `claude-opus-5-5`, overridable with `ANTHROPIC_MODEL`.
- `zod` for all schemas (interview extraction, synthesis, API bodies).
- `better-sqlite3` for persistence (single file `data/worktalk.db`, created on first run, gitignored). Plain SQL, no ORM.
- `mermaid` (client-side render of the process map). Build the Mermaid source on the server from the synthesis JSON; sanitise node labels (strip quotes/brackets/semicolons) so arbitrary LLM text cannot break the diagram.
- Voice: browser **Web Speech API** only (`webkitSpeechRecognition` / `SpeechRecognition` for input, `speechSynthesis` for reading the agent's question aloud). No third-party speech service. Feature-detect and hide the mic button if unsupported. Text chat must work everywhere.
- `vitest` for unit tests.
- No auth, no billing, no admin, no email sending, no screen-share/camera capture, no multi-language UI (the interviewer should still answer in the participant's language if they write in another language — one line in the system prompt).

## Mock mode (required — assume no API key is present)
`lib/llm.ts` exposes `isMockMode()` = `!process.env.ANTHROPIC_API_KEY`. In mock mode:
- The interviewer is a deterministic scripted interviewer (`lib/mock-interviewer.ts`): a question bank that walks the coverage checklist in order (trigger → steps → tools → manual work → handoffs/people → exceptions → pain points → wrap-up) and picks the next uncovered area; it echoes a short acknowledgement of the previous answer. Streams its reply through the same API route so the UI is identical.
- Extraction and synthesis return deterministic fixtures derived from the transcript with simple heuristics (e.g. one step per participant message that contains a verb-ish phrase, pain points for messages containing "manual", "copy", "wait", "slow", "twice", "excel", "email", etc.). It does not have to be clever; it has to produce a valid object that renders a non-trivial map.
- The UI shows a small "Mock mode — set ANTHROPIC_API_KEY for real interviews" banner.
With a key present, the real model is used for all three stages. Both paths share the same zod schemas and the same UI.

## Core user flows (implement all five)
1. **Create a study** (`/` → `/studies/new`): title, topic/question under investigation, goal (free text), optional list of teams/sites. Creates the study and lands on `/studies/[id]`.
2. **Invite participants** (`/studies/[id]`): add participant (name optional, team, site, role). Each gets a unique token and a link `/interview/[token]` shown with a copy button. Status: invited → in_progress → completed.
3. **Interview** (`/interview/[token]`): chat UI (`useChat` from `@ai-sdk/react` or an equivalent minimal fetch+stream loop if the installed `useChat` API is awkward). First message comes from the agent. Right-hand panel shows a **coverage checklist** (trigger, steps, tools, manual work, handoffs, exceptions, pain points) that ticks off as the server marks areas covered (the server returns coverage in a response header or a separate lightweight endpoint `GET /api/interviews/[token]/coverage`). "Finish interview" button (enabled after ≥6 participant turns or when all areas are covered) → runs extraction → thank-you screen with a short summary of what was captured. Optional mic button + "read questions aloud" toggle (Web Speech API).
4. **Study dashboard** (`/studies/[id]`): "Synthesise" button (re)computes the study synthesis from all completed extractions; shows: merged process map (Mermaid), steps table (step, owner role, tools, manual?, mentioned-by count), pain points grouped by team then site (description, severity, count, one representative quote), exceptions list, recommendations (type: eliminate / automate / standardise / clarify-owner; rationale; affected steps), and the list of interviews with a link to each transcript + extraction (`/studies/[id]/interviews/[participantId]`).
5. **Context export**: `GET /api/studies/[id]/context.md` (Markdown document designed to be pasted into another agent's context: purpose, process map as Mermaid code block, steps, exceptions, pain points, recommendations, provenance counts) and `GET /api/studies/[id]/context.json` (the synthesis object). Download buttons on the dashboard.

## Data model (SQLite)
- `studies(id TEXT PK, title, topic, goal, teams_json, created_at)`
- `participants(id TEXT PK, study_id FK, token TEXT UNIQUE, name, team, site, role, status TEXT CHECK in ('invited','in_progress','completed'), created_at, completed_at)`
- `messages(id INTEGER PK, participant_id FK, role TEXT ('user'|'assistant'), content TEXT, created_at)`
- `coverage(participant_id PK FK, areas_json)`  — array of covered area keys
- `extractions(participant_id PK FK, json TEXT, model TEXT, created_at)`
- `syntheses(study_id PK FK, json TEXT, mermaid TEXT, model TEXT, interview_count INT, created_at)`
Ids: `crypto.randomUUID()`; tokens: 16 random url-safe chars.

## Schemas (zod, in `lib/schemas.ts`)
```ts
InterviewExtraction = {
  summary: string,
  trigger: string,                              // what starts the workflow
  steps: { id: string, name: string, actorRole: string, tools: string[], manual: boolean, durationHint?: string, notes?: string }[],
  handoffs: { fromStep: string, toStep: string, toRole: string, channel: string }[],  // channel: email/slack/erp/verbal/...
  exceptions: { condition: string, whatHappens: string }[],
  painPoints: { description: string, severity: 'low'|'medium'|'high', quote: string, relatedStepIds: string[] }[],
  automationCandidates: { stepIds: string[], idea: string, confidence: 'low'|'medium'|'high' }[],
  coverage: Area[]  // Area = 'trigger'|'steps'|'tools'|'manual_work'|'handoffs'|'exceptions'|'pain_points'
}
StudySynthesis = {
  headline: string,
  mergedSteps: { id: string, name: string, actorRole: string, tools: string[], manual: boolean, mentionedBy: number, variants?: string[] }[],
  edges: { from: string, to: string, label?: string }[],      // for the Mermaid map; ids reference mergedSteps
  exceptions: { condition: string, whatHappens: string, mentionedBy: number }[],
  painPoints: { description: string, severity, count: number, teams: string[], sites: string[], quote: string }[],
  recommendations: { type: 'eliminate'|'automate'|'standardise'|'clarify_owner', title: string, rationale: string, stepIds: string[] }[],
  openQuestions: string[]
}
```

## LLM pipeline design (`lib/prompts.ts`)
- **Interviewer system prompt**: role = experienced process consultant running a 15–20 minute employee interview about `{topic}` for study `{title}` (goal `{goal}`); participant context (team/site/role if known). Rules: one question at a time, max 2 sentences per turn, plain language, no leading questions, follow the participant's thread but steer toward uncovered areas listed in `{uncoveredAreas}`, ask "why is that manual?" / "what happens when X goes wrong?" / "who do you hand that to?" style follow-ups, never give advice during the interview, reply in the participant's language, when every area is covered or after ~12 participant turns ask one closing question ("anything you'd fix tomorrow if you could?") and then say the interview is complete. Append the list of already-covered areas each turn (computed server-side).
- **Coverage classification** per turn: cheap heuristic (keyword map per area) in mock mode; with a key, a tiny structured call that returns `{ newlyCovered: Area[] }` after each participant message. Union into `coverage.areas_json`.
- **Extraction**: structured object from the full transcript → `InterviewExtraction`. Instruction: only include what the participant actually said; quotes verbatim; mark `manual` true only when stated or strongly implied.
- **Synthesis**: structured object from all extractions of a study (include team/site/role metadata per extraction) → `StudySynthesis`. Instruction: merge equivalent steps across interviews (keep `mentionedBy` counts), keep the order most participants described, keep exceptions as branches, recommendations must cite step ids. Then build Mermaid `flowchart TD` server-side from `mergedSteps` + `edges` (`lib/mermaid.ts`), with manual steps styled with a `classDef manual` and exceptions as diamond nodes.

## Screens / endpoints
Pages: `/` (study list + "New study"), `/studies/new`, `/studies/[id]`, `/studies/[id]/interviews/[participantId]`, `/interview/[token]` (participant-facing, no nav chrome).
API (route handlers under `src/app/api`):
- `GET/POST /api/studies`, `GET /api/studies/[id]`
- `POST /api/studies/[id]/participants`
- `POST /api/studies/[id]/synthesise` → recompute; `GET /api/studies/[id]/context.md`, `GET /api/studies/[id]/context.json`
- `GET /api/interviews/[token]` (study title/topic, participant, prior messages, coverage), `POST /api/interviews/[token]/chat` (streams assistant reply; persists both messages; updates coverage), `GET /api/interviews/[token]/coverage`, `POST /api/interviews/[token]/finish` (runs extraction, marks completed, returns extraction)
- `GET /api/health` → `{ ok: true, mock: boolean }`

## Environment variables (`.env.example`)
- `ANTHROPIC_API_KEY` — optional; absent ⇒ mock mode
- `ANTHROPIC_MODEL` — default `claude-opus-5-5`
- `DATABASE_PATH` — default `./data/worktalk.db`
- `NEXT_PUBLIC_APP_URL` — default `http://localhost:3000` (used to build invite links)

## Seed data
`npm run seed` (`scripts/seed.ts`, run with `tsx`) creates one demo study ("Sales quote creation — EMEA") with 3 **completed** mock interviews (realistic transcripts of 8–10 turns each from different teams/sites: Sales/Vienna, Sales Ops/Munich, Finance/Munich), their extractions, and a synthesis, so the dashboard is populated on first visit. Seeding must be idempotent (skip if the demo study exists). Run it automatically in `predev`/`prestart` only if the DB file does not exist.

## Skip
Auth, billing, admin, email invites, real telephony/voice infra, screen/camera capture, multi-tenant, i18n UI, MCP server (list it under "next to build" in the README).

## Acceptance checks (the build must pass all of these; run them and paste the output in the report)
1. `npm install` and `npm run build` succeed with zero TypeScript errors; `npm run lint` passes (or warnings only).
2. `npm test` (vitest) passes with at least: tests for `lib/mermaid.ts` (label sanitisation, manual class, diamond exceptions), tests for the mock interviewer (walks all areas, terminates), a test that mock extraction output validates against `InterviewExtraction`, and a test that the context.md builder includes the Mermaid block.
3. With no `ANTHROPIC_API_KEY` set, `npm run dev` (or `npm run build && npm start`) boots on port 3000; `curl -s localhost:3000/api/health` returns `{"ok":true,"mock":true}`.
4. End-to-end via curl in mock mode: create a study → add a participant → POST 7 chat messages → coverage endpoint shows ≥5 areas → finish → extraction has ≥3 steps and ≥1 pain point → synthesise → `context.json` has ≥3 `mergedSteps` and `context.md` contains a ```mermaid block → the `/studies/[id]` page returns 200 and contains the study title.
5. Seeded demo study is listed on `/` with 3 completed interviews and a rendered synthesis.
6. `.gitignore` excludes `node_modules`, `.next`, `data/*.db*`, `.env*` (but keeps `.env.example`); `git status` inside the folder shows no such files.
