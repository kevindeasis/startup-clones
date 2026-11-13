# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Round 0 — initial build prompt

You are building a working clone of the YC F26 startup Sona8 inside the folder `/home/user/startup-clones/2026-11-13-sona8/` (call it `<DIR>`). The folder already contains `SPEC.md`, `BUILD_PROMPT.md` and `BUILD_LOG.md` — leave those three files alone and build everything else next to them. Build the working end-to-end clone exactly per the spec below. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them.

Rules:
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. Assume NO `ANTHROPIC_API_KEY` is available in this environment: mock mode must be first-class and is what you will verify with.
- Add a `.gitignore` appropriate for the stack (node_modules, .next, .env*, data/*.db*, build output, coverage, *.log) — keep `.env.example` tracked.
- Verify it: install dependencies, run the build, run the tests, and start the app locally to confirm it boots and the main flow works end to end (mock mode). Fix errors before finishing. Do not claim it works unless you actually ran it. Run every acceptance check in the spec and keep the exact commands and outputs for your report. Stop any background server when done (`pkill -f "next"` or kill the PID you started).
- Node 22 and npm 10 are installed. Network access to the npm registry works. `npx create-next-app@latest` may prompt; pass all flags non-interactively or scaffold by hand (`package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, etc.). Before writing any code that uses the Vercel AI SDK, inspect the installed package's type definitions (`node_modules/ai/dist/index.d.ts`, `node_modules/@ai-sdk/react/dist/index.d.ts`) and use the exports that actually exist in the installed major version (v7 of `ai`, v4 of `@ai-sdk/react` and `@ai-sdk/anthropic`); do not rely on memory of older versions. If `useChat` is awkward in the installed version, write a small fetch + ReadableStream reader hook instead.
- `better-sqlite3` needs a native build; if `npm install` fails to build it, run `npm rebuild better-sqlite3` and if that still fails, switch to `node:sqlite` (built into Node 22) behind the same `lib/db.ts` interface and say so in the README.
- Write a thorough `README.md` in `<DIR>`: what the original company does (with links https://sona8.com and https://www.ycombinator.com/companies/sona8), what this clone does and what it skips, architecture summary (a short text diagram), the GitHub tools used (table: library, link, what it covers), exact setup and run steps, environment variables, mock mode explanation, known limitations, and the next 3 things to build (include "MCP server exposing the study context"). State clearly that it is an independent learning clone built for education and not affiliated with Sona8.
- Do not modify anything outside `<DIR>`. Do not run `git add`, `git commit` or `git push`.
- Keep the code readable: small files, typed, no dead code, comments only where the logic is non-obvious.
- At the end, report back in this structure: (1) what was built (file tree, one line per important file); (2) the exact verification commands you ran and their results, including the acceptance-check outputs; (3) anything that does not work or was changed from the spec and why; (4) your total input and output token usage as reported by your environment, or your best estimate.

---- SPEC.md (full contents) ----

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

## Round 1 — fix prompt (sent after the main agent's review)

Fix round 1 for the Worktalk build in `/home/user/startup-clones/2026-11-13-sona8/`. One blocking bug found during review, verified in a real headless Chromium:

**Bug:** the participant page `/interview/[token]` crashes into Next's error boundary ("This page couldn't load") as soon as it renders. Dev-mode stack: `TypeError: destroy is not a function` in `commitHookEffectListUnmount`, preceded by the React warning "useEffect must not return anything besides a function, which is used for clean-up". Cause: in `src/components/InterviewClient.tsx` the scroll effect is written as `useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [state?.messages]);` — the concise arrow returns the result of `scrollIntoView` as the effect's cleanup. Wrap the body in braces so the effect returns nothing. Grep the rest of `src/` for any other `useEffect(() => <expression>)` with the same shape and fix those too.

Then re-verify, and this time in a browser as well:
1. `npm run build`, `npm test`, `npm run lint` must still pass (run with `env -u ANTHROPIC_API_KEY`).
2. Start the production server (`env -u ANTHROPIC_API_KEY npm start`, port 3000) and run a headless Playwright check. Playwright is preinstalled at `/opt/node-tools/node_modules/playwright` (import it with `import pw from '/opt/node-tools/node_modules/playwright/index.js'; const { chromium } = pw;` from an `.mjs` script in `/tmp/claude-0/-home-user-startup-clones/2aeda39f-c7e3-5d13-bb76-1aa46d8639ef/scratchpad/`, not inside the project; `chromium.launch()` needs no options). The script must: create a study and participant via the API, open `/interview/<token>`, assert there are no `pageerror` events, type an answer into the input (`input[placeholder^="Type your answer"]`), press Enter, wait for the streamed reply to appear in `[data-testid="messages"]`, assert the coverage list shows at least one ☑, send 6 more answers, click "Finish interview", and assert the thank-you screen appears. Also open the seeded demo study dashboard and assert `[data-testid="process-map"] svg` exists with ≥ 10 `g.node` elements. Print the assertions' results.
3. Stop the server when done. Do not touch SPEC.md, BUILD_PROMPT.md or BUILD_LOG.md. Do not commit.
4. Update README.md: remove the "Mermaid rendering ... was not exercised in a real browser" limitation now that it is verified, and mention the browser check in a short "Verification" subsection.

Report: the diff of what you changed, the exact commands and outputs, and your token usage.
