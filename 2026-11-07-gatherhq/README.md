# Gatherlite — a local clone of GatherHQ

> Specified by Claude Fable 5.1 and built by a Claude Sonnet subagent on 2026-11-07.

## The original company

[GatherHQ](https://gatherhq.com) (YC F26) calls itself "an API for how buyers think." A marketing, product or insights team says what it wants to learn; an AI researcher designs the study, interviews real participants adaptively, stores what it learns, and maintains a living buyer model that people (web app / Slack) and agents (API / MCP) can query. The model can also simulate buyer reactions to pricing, messaging or ideas, and research can be turned into content.
YC launch page: https://www.ycombinator.com/launches/WI6-gatherhq-an-api-for-how-buyers-think-built-for-agents-and-teams

## What this clone does

The core loop, end to end, locally, with one LLM provider (Anthropic):

1. Create a study (title, goal, audience, optional seed questions); the AI drafts a 5-8 question interview guide, which you can edit and save.
2. Shareable interview link `/interview/[token]`: an AI interviewer greets, asks one question at a time, asks one follow-up on short/vague answers, then thanks and completes the interview. Every message is stored.
3. "Run synthetic panel" (N=1-8, default 3): AI-generated personas are interviewed server-side by the AI interviewer (max 10 turns each).
4. Synthesize: builds a buyer model (summary, themes with verbatim quotes citing `[int:<id>]`, objections, jobs-to-be-done, segments, recommended messages).
5. Ask the model: MiniSearch retrieval over Q/A chunks, LLM answer citing interview ids. Also `POST /api/studies/[id]/ask` for agents.
6. Simulate: paste a message/price/idea, get 3-5 segment reactions (sentiment -2..2, objection, example quote), labeled "Illustrative buyer model — simulated, not real quotes."
7. Export a Markdown report (`GET /api/studies/[id]/report`).

**Skipped (per spec):** auth, teams, billing, Slack bot, participant recruiting/incentives, real panel, MCP server, content generation beyond the report, embeddings, deployment config.

## Architecture

- `src/lib/db.ts` — better-sqlite3 singleton; runs `schema.sql` on first use (`data/gatherlite.db`). Tables: studies, questions, interviews, messages (extra `kind` column used to track question/follow-up/closing), buyer_models.
- `src/lib/llm.ts` — the only place that calls an LLM (Vercel AI SDK `generateObject` / `generateText`); contains the deterministic mock implementation. `src/lib/prompts.ts` holds all prompts, `schemas.ts` the zod schemas.
- `src/lib/interview.ts` — interview state machine (counts asked guide questions and follow-ups in code, so the LLM only phrases turns). `retrieval.ts` — MiniSearch chunking/search.
- `src/app/api/**` — route handlers (see spec section 6). UI: `/` (list + new study), `/studies/[id]` (dashboard), `/interview/[token]` (participant chat), all plain `fetch` clients.

## Open-source tools used

- [Next.js](https://github.com/vercel/next.js) (16, App Router, Turbopack) — app, routing, API routes
- [Vercel AI SDK](https://github.com/vercel/ai) (`ai` 7, `@ai-sdk/anthropic`) — LLM calls, structured output
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — persistence
- [MiniSearch](https://github.com/lucaong/minisearch) — lexical retrieval
- [zod](https://github.com/colinhacks/zod) — schemas / validation
- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (v4) — styling
- [nanoid](https://github.com/ai/nanoid) — ids/tokens

## Setup and run

Requires Node 20+ (tested on 22).

```bash
npm install
cp .env.example .env.local     # then edit; leave ANTHROPIC_API_KEY blank for mock mode
npm run dev                    # http://localhost:3000
# in another terminal, with the server running:
npm run smoke                  # acceptance checks A3-A9 (needs curl + jq)
```
Production: `npm run build && npm start`. Mock mode run: `MOCK_LLM=1 npm run dev`.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables real LLM output. Missing => mock mode. |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5-5` (the spec originally said `claude-sonnet-4-5`, which Anthropic now lists as deprecated). |
| `MOCK_LLM` | `1` forces mock mode even with a key. |
| `DATABASE_PATH` | Default `./data/gatherlite.db`. |
| `NEXT_PUBLIC_BASE_URL` | Used to build interview URLs returned by the API. |

## Mock mode

If `MOCK_LLM=1` or no `ANTHROPIC_API_KEY`, `llm.ts` returns deterministic fake output for every call shape (guide, interviewer, persona, synthesis, ask, simulate); the interviewer asks guide questions verbatim (plus a canned follow-up on answers under 6 words), a console warning is logged, and the header shows a "Mock LLM mode" badge. All verification was done in this mode; **the real Anthropic path type-checks and builds but was never run against the live API** (no key available).

## Known limitations

- Real-LLM path untested; prompts and structured-output schemas may need tuning (e.g. the `[FOLLOWUP]` marker convention for the interviewer).
- No streaming: chat endpoints return the whole reply (spec allowed simple `fetch`); `streamText` is not used.
- Synthetic panel runs synchronously inside one HTTP request (slow with a real LLM and N=8).
- Retrieval is lexical only; Ask falls back to the first chunks if nothing matches.
- No auth: anyone with the URL can use every endpoint. Interviews are not resumable-by-participant beyond reloading the same link.
- `next.config.ts` keeps the scaffold's Turbopack Tailwind loader rule; `npm run dev`/`build` use Turbopack.
- Smoke script requires `jq`.

## Next 3 things to build

1. Real-participant flow polish: resumable sessions, voice/audio answers, quality checks and a participant-facing consent screen.
2. An MCP server / authenticated API keys exposing `ask` and `simulate` to agents, with a living model that updates incrementally after each interview.
3. Embedding-based or hybrid retrieval plus streamed responses, and content generation (social posts, decks) from the buyer model.
