# Roma clone - "the to-do list that does itself"

> **Independent, unofficial clone for learning purposes. Not affiliated with, endorsed by, or connected to Roma or Y Combinator.** Built from the public product description only.

## The original

[Roma](https://roma.app) (YC F26, [YC page](https://www.ycombinator.com/companies/roma), [launch post](https://www.ycombinator.com/launches/UfU-roma-the-to-do-list-that-does-itself)) is a consumer to-do app (web, Mac, iPhone) with an AI operator underneath. You type, speak or share a photo in plain language and the operator decides whether it is a to-do (becomes verb-first tasks with parsed due dates on the right list), a question (answered, optionally with web search) or a passing thought (answered, nothing saved). It has per-task conversations, custom lists, scheduled automations, approval cards before anything leaves the app or deletes data, and an MCP server so Claude/ChatGPT/Cursor can work on your lists.

## What this clone does

- **Operator chat**: one thread; creates tasks/notes, answers questions, replies to thoughts. Created items and approvals render as cards in the thread.
- **Lists and items**: Tasks, Notes and custom lists with free-form fields; check off, edit title/body/due date/time, move between lists; soft delete with a Trash view (restorable; purged after 30 days).
- **Per-item conversation**: side panel chat scoped to one item (research via web search, draft/rewrite body, update fields).
- **Approval cards**: `send_email` never executes directly; approving writes to an `outbox` table (no real mail). `delete_items` and bulk updates (>= 5) also need approval.
- **Automations**: cron or preset schedules (node-cron, started from `instrumentation.ts`), Run now, run history.
- **MCP server** (stdio) with `get_context`, `list_lists`, `list_items`, `get_item`, `search`, `create_items`, `update_items`.

Skipped (per spec): auth, multi-user, mobile/Mac apps, voice/photo input, real Gmail/Calendar/etc. connections, semantic search, offline sync, version history, billing.

## Architecture

```
app/                 Next.js App Router (pages: /, /lists/[id], /automations, /trash, /outbox)
app/api/**           REST route handlers (context, lists, items, search, operator, approvals, automations, outbox)
components/          Shell (sidebar), Workspace, Chat (+ approval cards), ItemPanel
lib/db/              better-sqlite3 + drizzle-orm; tables created at startup (CREATE TABLE IF NOT EXISTS) and seeded
lib/ops.ts           data layer shared by API routes and operator tools
lib/operator/        index.ts (runOperator, mock/real switch), tools.ts (single tool implementation set),
                     real.ts (AI SDK + Anthropic), mock.ts (rule-based driver using the same tools)
lib/automations.ts   scheduler + runAutomation;  instrumentation.ts starts it once
mcp/server.ts        stdio MCP server that calls the REST API
scripts/acceptance.ts  smoke test against a running server
```

Both operator modes call the same `buildTools()` implementations in `lib/operator/tools.ts`, so mock mode exercises the real code paths (item creation, approvals, soft delete, etc.).

### Libraries / tools used

- [Next.js](https://github.com/vercel/next.js) 16 + [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- [Vercel AI SDK](https://github.com/vercel/ai) (`ai` v7, `generateText` + `tool` + `stepCountIs(6)`) and [`@ai-sdk/anthropic`](https://github.com/vercel/ai/tree/main/packages/anthropic)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) + [drizzle-orm](https://github.com/drizzle-team/drizzle-orm)
- [chrono-node](https://github.com/wanasit/chrono) natural-language dates
- [duck-duck-scrape](https://github.com/Snazzah/duck-duck-scrape) keyless web search (best effort)
- [node-cron](https://github.com/node-cron/node-cron) automations
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) MCP server
- [zod](https://github.com/colinhacks/zod), [nanoid](https://github.com/ai/nanoid), [tsx](https://github.com/privatenumber/tsx)

## Setup and run

```bash
npm install
cp .env.example .env          # optional; add ANTHROPIC_API_KEY for the real operator
MOCK_LLM=1 npm run dev        # http://localhost:3000   (or: npm run build && MOCK_LLM=1 npm start)
npm test                      # smoke test against the running server
npm run typecheck             # tsc --noEmit
```

The SQLite file `data/roma.db` is created and seeded on first request/boot (lists Tasks and Notes, 3 sample tasks, one disabled sample automation).

Tailwind v4 is wired through the Turbopack loader rule in `next.config.ts` (`@tailwindcss/turbopack`), not PostCSS; if you switch to webpack, install `@tailwindcss/postcss` and add a `postcss.config.mjs` instead.

## Environment variables

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the real operator |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-4-5` |
| `MOCK_LLM` | `1` forces the rule-based mock operator (also used automatically when no key is set) |
| `DATABASE_PATH` | Default `./data/roma.db` |
| `ROMA_API_URL` | Where the MCP server finds the app (default `http://localhost:3000`) |
| `TZ` | Optional; "today" is computed in server local time |

## Mock mode

With `MOCK_LLM=1` (or no API key) `runOperator` uses `lib/operator/mock.ts`: the message is split on `,` `;` newlines and ` and `. Per clause: ends with `?` -> "I can't look that up in mock mode." (per-item chats add a mock research note and call `web_search`); `delete ...` -> `delete_items` approval; contains email/mail/send -> `send_email` approval; "note" or an imperative/verb-first clause -> `create_items` (date from chrono-node, forward-dated, trailing date phrase stripped from the title); in an item chat, "draft/rewrite/research..." updates the body via `update_items`; "briefing" uses `get_context`; anything else is a thought: reply, save nothing. The chat UI shows a "Mock operator" banner.

## MCP server

Start the app, then:

```bash
npm run mcp     # stdio server; reads ROMA_API_URL
```

Claude Code:

```bash
claude mcp add roma -- npx --prefix /absolute/path/to/this/folder tsx /absolute/path/to/this/folder/mcp/server.ts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "roma": {
  "command": "npx", "args": ["tsx", "/absolute/path/to/this/folder/mcp/server.ts"],
  "env": { "ROMA_API_URL": "http://localhost:3000" } } } }
```

## Assumptions and known limitations

- "Today" and weekday use server local time. Dates are plain `YYYY-MM-DD`; times `HH:MM`; no reminders are actually fired.
- Schema is created with `CREATE TABLE IF NOT EXISTS` at startup (no drizzle-kit migrations); schema changes need a manual migration or deleting `data/roma.db`.
- Non-streaming operator responses; the real path was written against `ai` v7 typings and type-checks, but could **not** be run here (no API key) - treat it as untested against the live API.
- `web_search` depends on DuckDuckGo scraping, which is often blocked or rate-limited; it degrades to a "Search unavailable" result (it returned no results in the sandbox used to build this).
- The scheduler runs inside the Next.js server process (single instance, needs a long-running `next start`/`dev`; not suited to serverless).
- No auth: anyone who can reach the port can read/write everything.
- Deleting a custom list moves its items to Tasks and trashes nothing else; only custom lists can be deleted.
- Mock title cleanup is heuristic; weird phrasing may be treated as a thought.
- `next build` prints a Turbopack warning about dynamic filesystem access from `DATABASE_PATH`; harmless.

## Next 3 things to build

1. Streaming operator responses (`streamText` + UI message stream) and tool-call progress in the chat.
2. Real reminders (time-based notifications) and recurring tasks, plus semantic search with embeddings.
3. Auth and per-user data, real integrations (Gmail/Calendar) behind the same approval cards, and an MCP server over HTTP with API tokens.
