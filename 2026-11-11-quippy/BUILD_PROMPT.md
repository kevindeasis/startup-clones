# BUILD_PROMPT.md — verbatim prompts sent to the Sonnet build subagent

## Round 0 — initial build prompt (model: sonnet, subagent_type: general-purpose)

You are building a working clone of the YC F26 startup Quippy inside the folder `/home/user/startup-clones/2026-11-11-quippy/` (call it PROJECT). A `SPEC.md` is already in that folder; its full contents are reproduced below. Build exactly what the spec says.

### Instructions
- Build the working end-to-end clone inside PROJECT exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries (Next.js, Vercel AI SDK `ai` + `@ai-sdk/anthropic` + `@ai-sdk/react`, Zod, lowdb, Tailwind, Vitest) instead of reinventing them. Scaffold with `npx create-next-app@latest` into PROJECT (the folder already contains SPEC.md; scaffold into a temp dir and move the files in if create-next-app refuses a non-empty folder, or scaffold with `--yes` flags into the folder directly). Keep `SPEC.md` intact.
- The Vercel AI SDK major version installed may differ from what you remember. Before writing LLM code, read `node_modules/ai/dist/index.d.ts` (grep for `streamText`, `generateText`, `generateObject`, `Output`, `toUIMessageStreamResponse`, `convertToModelMessages`) and `node_modules/@ai-sdk/react/dist/index.d.ts` (grep for `useChat`, `DefaultChatTransport`) and use the APIs that actually exist there.
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. Assume NO API key is present in this environment: mock mode (`LLM_MOCK=1` or missing `ANTHROPIC_API_KEY`) must make the whole app work.
- Add a `.gitignore` appropriate for the stack (node_modules, .env*, .next, out, data/, coverage, *.log, .DS_Store). `data/db.json` must never be committed.
- Verify it: `npm install`, `npm run build`, `npm test`, then start the app (`LLM_MOCK=1 npm run start` on a free port, or `npm run dev`) and exercise every acceptance check in SPEC.md section 10 with curl (or a short Node/Playwright script; Playwright is preinstalled via `require('playwright')`, do not run `playwright install`). Fix errors before finishing. Do not claim something works unless you actually ran it. Stop any background server when done (`kill` the PID you started).
- Write a thorough `README.md` in PROJECT: what the original company does (with link https://quippyapp.com and https://www.ycombinator.com/companies/quippy), what this clone does and what it skips, architecture summary, the GitHub tools used (with links), exact setup and run steps, environment variables, mock mode, known limitations, and the next 3 things to build. State clearly that it is an independent learning clone not affiliated with Quippy.
- Do not modify anything outside PROJECT. Do not run `git commit` or `git push`. Do not touch git config.
- Report back at the end: what was built (file tree summary), exactly which verification commands you ran and their results (paste the key output lines), anything that does not work, and your total input/output token usage.

### SPEC.md (verbatim)

# SPEC — Quippy clone ("Rehearsal Room")

**Original company:** Quippy (YC F26) — https://quippyapp.com — https://www.ycombinator.com/companies/quippy
**Date:** 2026-11-11
**Status of this document:** build spec handed to the coding subagent. The clone is an independent learning project, not affiliated with Quippy.

## 1. What the product does

Quippy is "a daily practice app for your social life": like the gym, but for conversations. The user picks a short, realistic scenario (pushing back on a boss, inviting someone out, a first date, a reconnect call home), rehearses their side of the conversation with an AI scene partner by text or voice for about three minutes, and gets **line-by-line feedback** on which of their lines landed and which backfired, with a stronger rewrite. After the scenario, the weakest line becomes a short **drill**. A lightweight **curriculum** of units/lessons unlocks as the user progresses and adapts around the user's recurring weak spots.

The clone implements that loop end to end as a local web app.

## 2. Core user flows (implement all five)

1. **Pick a scenario.** Home screen shows a curriculum: 4 units × 2 lessons = 8 scenarios matching Quippy's public interaction types: *The opener, The follow-up, The invite, Saying yes, The first date, The reconnect, The real answer, The call home*. Each scenario card shows: title, who you're talking to (character name + one-line persona), the stakes, your goal, and locked/unlocked/completed state. Lesson N+1 in a unit unlocks when lesson N is completed; unit N+1 unlocks when unit N is completed. A "Practice anything" free-text option lets the user describe their own situation and generates a scenario on the fly.
2. **Rehearse.** A chat screen. The scene partner (LLM) opens with a first line in character. User replies by typing, or by tapping a mic button that uses the browser's Web Speech API (`webkitSpeechRecognition`) to dictate into the input (text fallback if unsupported). Partner replies stream in. Each partner turn stays in character, is ≤ 2 short sentences, reacts realistically to what the user said (warms up, cools off, pushes back), and never breaks character to coach. The session ends after the user has sent 6 lines or when the user taps **End & get feedback**.
3. **Line-by-line feedback.** After the session the app calls the LLM once with the full transcript and the scenario goal and gets a structured review: for every *user* line a verdict (`landed` | `okay` | `backfired`), a one-sentence reason, and a `stronger` rewrite when the verdict is not `landed`; plus an overall score 0–100, a 2-sentence summary, the single `weakest_line_index`, and a `pattern` tag from a fixed list (e.g. `over-apologising`, `vague-ask`, `no-question-back`, `too-long`, `hedging`, `defensive`, `monologue`, `fine`). Render the transcript with the verdict chips inline under each user line and the rewrite shown under backfired/okay lines.
4. **Drill.** From the feedback screen, "Drill this line" opens a focused 1-turn exercise: show the original partner line and the user's weak line, ask the user to rewrite it, send it to the LLM, and get back a verdict + short coaching note + a model answer. Up to 3 attempts; the drill is marked done when a `landed` verdict comes back or the user gives up. Completing the scenario (feedback received) marks the lesson complete and unlocks the next one; the drill is optional.
5. **Progress.** A progress screen lists completed sessions (date, scenario, score, pattern), a streak counter (consecutive calendar days with ≥1 session), and a "Your patterns" panel counting pattern tags across sessions. The top pattern is used to **adapt** the curriculum: the next unlocked scenario's system prompt gets an extra "focus" instruction targeting that pattern (e.g. the partner will deliberately create a moment where the user tends to over-apologise), and the scenario card shows a small "Focus: <pattern>" badge.

## 3. Stack

- **Next.js 16 (App Router) + TypeScript** — UI and API routes in one app. `npx create-next-app@latest` defaults (Tailwind, ESLint, src/ off, App Router on, no Turbopack flags needed).
- **Vercel AI SDK** — `ai` (v7.x) + `@ai-sdk/anthropic` (v4.x) + `@ai-sdk/react` for streaming chat (`streamText` on the server, `useChat` on the client) and for structured output of the feedback/drill (`generateText` with `Output.object(...)` or `generateObject`, whichever the installed version exports; check `node_modules/ai/dist/index.d.ts`).
- **Zod** (v4) — schemas for the feedback and drill objects, shared between the server validator and the UI types.
- **lowdb** (v7, JSON file DB at `data/db.json`, gitignored) — persistence of sessions, feedback, drills and progress. No external DB.
- **Tailwind CSS** — styling. Keep it clean: one accent colour, system font, mobile-first, dark mode via `prefers-color-scheme`.
- **Browser Web Speech API** — optional voice input, no dependency.
- **Vitest** — a handful of unit tests for the pure logic (curriculum unlock rules, streak calculation, pattern aggregation, mock LLM).

Verified package registry metadata on 2026-11-11: `ai@7.0.x`, `@ai-sdk/anthropic@4.0.x`, `@ai-sdk/react@4.0.x`, `next@16.4.x`, `zod@4.x`. Node 22 / npm 10 are available.

## 4. LLM provider and mock mode

- Default provider: Anthropic via `ANTHROPIC_API_KEY`. Model ID from `ANTHROPIC_MODEL`, default `claude-sonnet-5-5` (current Sonnet listed on the Anthropic pricing page; cheap and good at role-play). Do not hard-code any other model ID.
- **Mock mode is mandatory.** If `ANTHROPIC_API_KEY` is unset *or* `LLM_MOCK=1`, every LLM call must go through `lib/llm/mock.ts` instead: a deterministic fake that (a) returns canned-but-scenario-aware partner lines (pick from a per-scenario list, cycling by turn index, streamed word-by-word via a small async generator so the UI streaming path is exercised), (b) returns a feedback object that heuristically scores user lines (e.g. lines containing "sorry" → `over-apologising`/`backfired`, lines > 40 words → `too-long`, lines with no "?" in a follow-up scenario → `no-question-back`, otherwise `landed`) and (c) grades drill attempts with the same heuristics. Mock mode must be visibly indicated in the UI with a small "Mock LLM" badge so nobody mistakes it for real feedback.
- Implement a single `lib/llm/index.ts` with two functions, `streamPartnerReply(...)` and `generateFeedback(...)`, `gradeDrill(...)`, `generateCustomScenario(...)`, each switching between real and mock. The real path uses the AI SDK; API routes never touch the provider directly.

## 5. Prompt / pipeline design

**Scene-partner system prompt** (per scenario, built from the scenario record):
> You are {character}, {persona}. Scene: {setting}. The other person's goal is: {goal}. Stakes: {stakes}. Stay fully in character. Reply in at most two short sentences, like real speech. React honestly to what they say: warm up when they are clear, specific and confident; get colder, busier or more defensive when they ramble, hedge, over-apologise or make it about themselves. Never coach, never mention that this is practice, never use bullet points. {focus_instruction}
Where `focus_instruction` is empty unless the user's top pattern applies, e.g. "Create one natural moment that tempts them to over-apologise."

The first partner line is generated the same way with a user message of `[The scene begins. Say your opening line.]`.

**Feedback prompt:** system prompt describes a warm but honest conversation coach; user content is the scenario (goal, character), the numbered transcript, and the instruction to return JSON matching the Zod schema (verdict/reason/stronger per user line, overall score, summary, weakest_line_index, pattern). Temperature 0.3. Validate with Zod; on parse failure retry once, then fall back to the mock grader so the UI never dead-ends.

**Drill prompt:** same coach persona; input is the partner line, the original weak line, the feedback reason, and the new attempt; output JSON `{ verdict, note, model_answer }`.

**Custom scenario prompt:** user describes a situation; output JSON `{ title, character, persona, setting, stakes, goal }` matching the scenario schema; saved to the DB under a "Custom" unit.

## 6. Data model (lowdb, `data/db.json`)

```ts
Scenario { id, unitId, order, title, type, character, persona, setting, stakes, goal, custom?: boolean }
Unit { id, order, title, blurb }
Session { id, scenarioId, startedAt, endedAt?, messages: {role:'user'|'partner', text, index}[], feedback?: Feedback, mock: boolean }
Feedback { score, summary, weakestLineIndex, pattern, lines: { index, verdict, reason, stronger? }[] }
Drill { id, sessionId, lineIndex, attempts: { text, verdict, note, modelAnswer }[], done: boolean }
Progress (derived at read time): completedScenarioIds, streakDays, patternCounts, topPattern
```
Seed the 4 units / 8 scenarios from `lib/curriculum.ts` on first run.

## 7. Screens and endpoints

Screens (App Router): `/` curriculum home, `/practice/[scenarioId]` chat, `/session/[sessionId]/feedback`, `/session/[sessionId]/drill`, `/progress`, plus a "Practice anything" modal or `/custom` page.

API routes:
- `POST /api/sessions` `{scenarioId}` → creates session, returns id + streamed opening partner line is fetched via chat route.
- `POST /api/chat` `{sessionId, messages}` → `streamText` partner reply (AI SDK UI message stream); persists the user line and the completed partner line.
- `POST /api/sessions/[id]/feedback` → runs feedback, stores it, marks scenario complete, returns Feedback.
- `POST /api/sessions/[id]/drill` `{lineIndex, attempt}` → grades attempt, stores it, returns result.
- `POST /api/scenarios/custom` `{description}` → generates and stores a custom scenario.
- `GET /api/progress` → derived progress.
Server components may read lowdb directly instead of calling GET routes.

## 8. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # leave blank to run in mock mode
ANTHROPIC_MODEL=claude-sonnet-5-5
LLM_MOCK=                     # set to 1 to force mock mode even with a key
```

## 9. Skip

Auth, accounts, billing, push notifications, native mobile apps, real-time voice (TTS/STT via paid APIs), the full 12-week program, admin tools. Single local user.

## 10. Acceptance checks (the build must pass all)

1. `npm install`, `npm run build` and `npm test` all exit 0.
2. `LLM_MOCK=1 npm run dev` (or `npm start` after build) boots, and `curl http://localhost:3000/` returns 200 with the 8 scenario titles in the HTML.
3. With no API key: open the first scenario, send 3 user lines (via curl against `/api/chat` or a Playwright script), end the session, and receive a feedback object with one entry per user line and a valid `pattern`; the lesson becomes completed and the next one unlocked (verify via the DB file or `/api/progress`).
4. Drill endpoint returns a graded attempt and marks the drill done on a `landed` verdict.
5. `/progress` shows the completed session, a streak of 1, and the pattern count.
6. Custom scenario endpoint creates a scenario that then appears on the home page.
7. `data/`, `.env`, `node_modules`, `.next` are gitignored; `.env.example` exists; README documents mock mode and real-key setup.
8. No secrets in the tree. No files outside `2026-11-11-quippy/` touched.
