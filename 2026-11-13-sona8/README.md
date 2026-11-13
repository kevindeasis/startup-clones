# Worktalk — a clone of Sona8 (2026-11-13)

> **Independent learning clone built for education. Not affiliated with, endorsed by, or derived from the code of Sona8.**

## What the original does

[Sona8](https://sona8.com) ([YC page](https://www.ycombinator.com/companies/sona8), YC Fall 2026) sends AI voice agents to interview employees about how their work actually gets done. A consulting or transformation team picks a topic ("how does a sales quote get created?"), invites the relevant employees, and each opens a link and talks to the agent for ~20 minutes in their own language. The agent asks adaptive follow-ups, and Sona8 turns the interviews into process maps, problem lists by team/site, optimisation/automation recommendations, and an exportable workflow map that other AI tools can use as context.

## What this clone does

- Create a **study** (title, topic, goal, teams) and invite **participants** by unique link.
- Participants take an **adaptive text interview** with a live **coverage checklist** (trigger, steps, tools, manual work, handoffs, exceptions, pain points). Optional browser voice: mic dictation and "read questions aloud" (Web Speech API, hidden if unsupported).
- Finishing an interview **extracts** a structured workflow record (zod-validated).
- The study dashboard **synthesises** all interviews: merged Mermaid process map (manual steps highlighted, exceptions as diamonds), steps table, pain points grouped by team then site, exceptions, recommendations, transcripts.
- **Context export** for other agents: `context.md` (with Mermaid block) and `context.json`.
- First-class **mock mode** (no API key needed) and a seeded demo study.

**Skipped:** auth, billing, admin, email invites, real telephony/voice infrastructure, screen/camera capture, multi-tenant, i18n UI, MCP server.

## Architecture

```
Browser (React 19, Tailwind)
  /, /studies/new, /studies/[id], /studies/[id]/interviews/[pid]   (server components read SQLite directly)
  /interview/[token]  --fetch + ReadableStream-->  POST /api/interviews/[token]/chat
        |                                              |  persists user msg, classifies coverage (X-Coverage header)
        |                                              v
        |                                   lib/chat.ts --> mock-interviewer.ts   (no key)
        |                                              \--> streamText(anthropic)  (key present)
        +--> POST /finish --> lib/pipeline.ts: extractInterview (mock-pipeline.ts | generateText + Output.object)
Dashboard --> POST /api/studies/[id]/synthesise --> synthesiseStudy --> lib/mermaid.ts (server-built flowchart)
           --> GET context.md / context.json  (lib/context.ts)
Persistence: better-sqlite3, data/worktalk.db (lib/db.ts schema, lib/repo.ts plain SQL)
```

## GitHub tools used

| Library | Link | Covers |
|---|---|---|
| Next.js 16 | https://github.com/vercel/next.js | App Router, route handlers, server components |
| Vercel AI SDK (`ai` v7) | https://github.com/vercel/ai | `streamText` for interview turns, `generateText` + `Output.object` for extraction/synthesis/coverage |
| `@ai-sdk/anthropic` v4 | https://github.com/vercel/ai | Claude provider |
| `@ai-sdk/react` v4 | https://github.com/vercel/ai | Installed per spec; the interview UI uses a small fetch + ReadableStream hook instead (plain-text stream + `X-Coverage` header is simpler than `useChat`'s UI-message protocol) |
| zod | https://github.com/colinhacks/zod | Extraction/synthesis schemas and API bodies |
| better-sqlite3 | https://github.com/WiseLibs/better-sqlite3 | Persistence |
| mermaid | https://github.com/mermaid-js/mermaid | Client-side process-map rendering |
| Tailwind CSS | https://github.com/tailwindlabs/tailwindcss | Styling |
| vitest | https://github.com/vitest-dev/vitest | Unit tests |
| tsx | https://github.com/privatenumber/tsx | Runs the seed script |

## Setup and run

```bash
npm install
cp .env.example .env.local     # optional; leave ANTHROPIC_API_KEY empty for mock mode
npm run dev                    # http://localhost:3000 (predev seeds the demo study if data/worktalk.db is missing)
# or production:
npm run build && npm start     # prestart seeds the same way
npm test                       # vitest
npm run lint
npm run seed                   # idempotent; creates "Sales quote creation — EMEA" with 3 completed interviews
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Optional. Absent means mock mode. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model id for all LLM stages |
| `DATABASE_PATH` | `./data/worktalk.db` | SQLite file (created on first run) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Base for invite links |

## Mock mode

`isMockMode()` (`src/lib/llm.ts`) is true when `ANTHROPIC_API_KEY` is unset. Then:
- The interviewer is a deterministic scripted bank (`lib/mock-interviewer.ts`): acknowledges the last answer, asks about the next uncovered area, never repeats a question, then asks the closing question and ends. It streams through the same API route.
- Coverage uses a keyword map per area; extraction and synthesis are heuristic (`lib/mock-pipeline.ts`): a step per answer containing a verb-ish phrase, pain points from words like manual/copy/wait/slow/twice/excel/email, similarity-based step merging.
- The UI shows a "Mock mode" banner. With a key, the real model runs all three stages using the same schemas and UI.

## Known limitations

- Voice is browser-only Web Speech API (Chrome/Edge/Safari); no real telephony and no multilingual UI (the interviewer is prompted to answer in the participant's language).
- Mock extraction/synthesis is crude: step names are the participant's own sentences and cross-interview merging is word-overlap based.
- The real-model path (Anthropic) was written against the installed AI SDK types but not exercised, since no API key was available.
- Exception nodes in the map hang off the first step, because the schema does not say where an exception branches.
- No auth: anyone with a study URL can see it; interview tokens are the only access control.

## Verification

Run in mock mode: `npm run build`, `npm test` (10 tests) and `npm run lint` pass, and the curl end-to-end flow was run against `npm start`. A headless Chromium (Playwright) check also drives the real UI: it opens an interview link, sends 7 answers, sees streamed replies and ticked coverage boxes, finishes to the thank-you screen with no page errors, and confirms the seeded dashboard renders the Mermaid map as an SVG with 26 nodes.

## Next 3 things to build

1. **MCP server exposing the study context** so Claude/other agents can query the process map, steps and pain points directly.
2. Real voice agent (streaming STT/TTS or realtime API) with multilingual interviews.
3. Evidence-linked synthesis: click a step or pain point to see the supporting transcript quotes, plus editable process maps.
