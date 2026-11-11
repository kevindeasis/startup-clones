# Rehearsal Room (Quippy clone)

> Independent learning clone. Not affiliated with, endorsed by, or derived from the code of Quippy.

## The original company

[Quippy](https://quippyapp.com) (YC F26, [YC profile](https://www.ycombinator.com/companies/quippy)) is a daily practice app for your social life: like the gym, but for conversations. You pick a short realistic scenario (pushing back on a boss, inviting someone out, a first date, a call home), rehearse your side with an AI scene partner by text or voice for about three minutes, and get line-by-line feedback on which lines landed and which backfired, with stronger rewrites. A curriculum adapts around your recurring weak spots.

## What this clone does

The full loop, as a local single-user web app:

1. **Curriculum home** (`/`): 4 units x 2 lessons (The opener, The follow-up, The invite, Saying yes, The first date, The reconnect, The real answer, The call home). Cards show persona, stakes, goal and locked/unlocked/completed state. Lesson N+1 unlocks when N is done; unit N+1 when unit N is done.
2. **Rehearse** (`/practice/[scenarioId]`): streaming chat with an in-character partner (max 2 short sentences). Type, or dictate with the browser Web Speech API mic button (hidden when unsupported). Ends after 6 lines or via "End & get feedback".
3. **Line-by-line feedback** (`/session/[id]/feedback`): per user line a verdict (`landed` / `okay` / `backfired`), reason and a stronger rewrite, plus score 0-100, 2-sentence summary, weakest line and a pattern tag.
4. **Drill** (`/session/[id]/drill`): rewrite the weakest line, up to 3 attempts, graded with a verdict, note and model answer. Done on `landed` or "Give up".
5. **Progress** (`/progress`): completed sessions, streak, pattern counts. The top non-`fine` pattern adapts the curriculum: the next unlocked scenario gets a "Focus: <pattern>" badge and an extra instruction in the partner system prompt.
6. **Practice anything** (`/custom`): describe a situation, the LLM turns it into a scenario saved under a "Custom" unit (always unlocked).

**Skipped** (per spec): auth, accounts, billing, push notifications, native apps, paid real-time voice (TTS/STT), the full 12-week program, admin tools.

## Architecture

- Next.js 16 App Router, TypeScript, Tailwind v4. Server components read the DB directly; API routes handle mutations.
- `lib/llm/index.ts` is the only place that touches a provider: `streamPartnerReply`, `generateFeedback`, `gradeDrill`, `generateCustomScenario`. Each switches between the real Anthropic path (Vercel AI SDK) and `lib/llm/mock.ts`.
- Chat: `/api/chat` builds a `createUIMessageStream` (real path merges `streamText(...).toUIMessageStream()`); the client uses `useChat` with `DefaultChatTransport`. The server persists the transcript itself (source of truth), so the model history is always built from the DB.
- Structured output: `generateText` with `Output.object({ schema })` and Zod (v4) schemas in `lib/schemas.ts`. Feedback is validated, retried once, then falls back to the mock grader so the UI never dead-ends.
- Persistence: lowdb JSON file `data/db.json` (gitignored), seeded from `lib/curriculum.ts` on first run. Writes are serialised through a queue in `lib/db.ts`. Progress is derived at read time (`lib/logic.ts`, `lib/progress.ts`).

```
app/            pages + API routes (chat, sessions, feedback, drill, scenarios/custom, progress)
components/     Practice (chat), Drill, ScenarioCard, StartButton, CustomForm
lib/            schemas, curriculum, logic (unlock/streak/patterns), patterns, db, progress
lib/llm/        index (real/mock switch), mock, prompts
tests/          Vitest unit tests
```

## GitHub tools used

- [Next.js](https://github.com/vercel/next.js) - app framework
- [Vercel AI SDK](https://github.com/vercel/ai) (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/react`) - streaming chat and structured output
- [Zod](https://github.com/colinhacks/zod) - schemas
- [lowdb](https://github.com/typicode/lowdb) - JSON file database
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) - styling
- [Vitest](https://github.com/vitest-dev/vitest) - unit tests

## Setup and run

Requires Node 22 and npm 10.

```bash
npm install
cp .env.example .env.local     # optional; leave the key blank for mock mode
npm run dev                    # http://localhost:3000
# or
npm run build && npm run start
npm test                       # unit tests
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic key. Blank or unset runs mock mode. |
| `ANTHROPIC_MODEL` | Model id, default `claude-sonnet-5-5`. |
| `LLM_MOCK` | Set to `1` to force mock mode even when a key is set. |
| `DB_PATH` | Optional path for the lowdb file (default `data/db.json`). |

## Mock mode

With no `ANTHROPIC_API_KEY`, or `LLM_MOCK=1`, everything runs offline through `lib/llm/mock.ts`: canned scenario-aware partner lines streamed word by word, a heuristic grader ("sorry" -> `over-apologising`/backfired, over 40 words -> `too-long`, a follow-up without "?" -> `no-question-back`, hedging words -> `hedging`, otherwise `landed`) and a template-based custom scenario. A "Mock LLM" badge shows in the header. To use the real model, set `ANTHROPIC_API_KEY` in `.env.local` and leave `LLM_MOCK` empty.

## Known limitations

- The real Anthropic path was not exercised here (no key available); it type-checks against the installed AI SDK but is untested against the live API.
- Mock feedback is keyword heuristics, not real coaching; mock rewrites can be clumsy.
- Single local user, no auth; the JSON DB is not safe for multiple server instances.
- Voice is input only (Web Speech API, Chromium/Safari); no spoken partner replies.
- Unfinished sessions are resumable by URL but there is no "resume" list in the UI.
- Streak days use the server's local time zone.

## Next 3 things to build

1. Spoken partner replies and hands-free voice (browser TTS first, then a realtime voice API).
2. Smarter adaptation: spaced-repetition drills across sessions for the user's recurring weak lines, not just a focus badge.
3. Run the feedback prompt against a small eval set of transcripts to tune quality, plus Playwright end-to-end tests in CI.
