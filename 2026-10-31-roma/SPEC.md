# Build spec — Roma clone ("the to-do list that does itself")

Date: 2026-10-31. Original company: **Roma** (YC F26) — https://roma.app — YC page: https://www.ycombinator.com/companies/roma — launch post: https://www.ycombinator.com/launches/UfU-roma-the-to-do-list-that-does-itself

## 1. What the product does (as publicly described)

Roma is a consumer to-do app (web, Mac, iPhone) with an AI "operator" underneath. You type, speak or share a photo in ordinary language; the operator decides what each message is:

- a to-do becomes one or more **tasks** with a cleaned-up verb-first title, a parsed due date (a due date is a *day* unless a time is stated; a stated time also sets a reminder), and placement on the right **list**;
- a **question** gets an answer (the operator can search the web for current information);
- a passing **thought** gets a reply and nothing is saved.

Every account has a default **Tasks** list and a **Notes** list; users can add custom lists with their own fields (e.g. a reading list with author + rating). Each task has its **own conversation** for researching, drafting or rewriting that item. **Automations** are scheduled standing instructions (e.g. "every morning, give me a briefing"). The operator acts on its own for low-risk reversible changes (create/edit/check off/move) but shows an **approval card** before anything that leaves Roma (sending mail, posting) and before deletions or large batch changes. External agents (Claude, ChatGPT, Cursor) can work on your lists through Roma's **MCP server** (tools such as `get_context`, `create_items`, `update_items`, `search`, `list_lists`, `list_items`).

## 2. What the clone implements — core user flows

1. **Operator chat → tasks.** A single chat thread. User sends free text ("call the dentist tomorrow, buy milk, and what's the capital of Peru?"). The operator classifies and acts: creates tasks (verb-first titles, due dates relative to *today*, list placement), answers questions inline, replies to thoughts without saving. Created items render as cards beneath the assistant message and appear in the list view immediately.
2. **Lists & items.** Sidebar with Tasks, Notes and custom lists. Create a custom list (name + optional custom fields as free-form key/value). Item view: check off, edit title/body/due date, move between lists, delete (soft delete, restorable for 30 days via a Trash view).
3. **Per-item conversation.** Open an item → a side panel with a chat scoped to that item. The operator can research it (web search tool), draft or rewrite its body, and update its fields. Changes are applied via the same tools as the main operator.
4. **Approval cards.** The operator has one "leaves Roma" tool: `send_email(to, subject, body)`. It is **never** executed directly; it creates a pending **approval** record rendered as a card (Approve / Reject). Approving runs the action (in this clone: logs it to an `outbox` table and shows it in an Outbox view — no real mail is sent). Bulk changes (≥5 items) and deletes requested via chat also go through an approval card.
5. **Automations.** Create a standing instruction with a cron expression or a preset ("every morning at 8", "every Saturday"). A scheduler runs due automations by feeding the instruction to the operator (e.g. "create a task 'water plants'" or "give me a briefing of today's due tasks") and stores a run record. A "Run now" button triggers it immediately.
6. **MCP server** (developer twist). A stdio MCP server (`mcp/server.ts`) exposing `get_context`, `list_lists`, `list_items`, `get_item`, `search`, `create_items`, `update_items` backed by the app's REST API, so Claude Desktop / Claude Code / Cursor can read and write the lists.

## 3. Stack

- **Next.js 15/16 (App Router) + TypeScript + Tailwind CSS**, single app, `npm run dev` on port 3000. Use `create-next-app` defaults (no `src/` dir is fine; your choice, stay consistent).
- **Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)** for the operator: `generateText` with tools and multi-step tool calling (`stopWhen: stepCountIs(n)` or the equivalent in the installed version — check `node_modules/ai` typings for the exact exports before writing code, since the installed major may be newer than you expect). Streaming is optional; a non-streaming JSON response is acceptable.
- **Anthropic** as the LLM provider: model `claude-sonnet-4-5` by default via `ANTHROPIC_MODEL`, key from `ANTHROPIC_API_KEY`.
- **SQLite via `better-sqlite3` + `drizzle-orm`** (file `data/roma.db`, created on first run, schema pushed with `drizzle-kit push` or created by a small `db/migrate.ts` executed at startup — pick the one that works without extra tooling in CI). If `better-sqlite3` fails to build in this environment, fall back to `@libsql/client` (file: URL) with Drizzle.
- **`chrono-node`** for natural-language date parsing (used in mock mode, and to normalize/validate dates the LLM returns).
- **`duck-duck-scrape`** for a no-API-key web search tool (best effort; return a clear "search unavailable" message on failure — never crash).
- **`node-cron`** for automations, started from `instrumentation.ts` (Next.js instrumentation hook) guarded so it starts once; also expose `POST /api/automations/:id/run` for "Run now".
- **`@modelcontextprotocol/sdk`** for the stdio MCP server, run with `npm run mcp` (uses `tsx`).
- **`zod`** for tool input schemas and request validation.

## 4. Mock mode (required — there is no API key in the build environment)

`lib/operator/index.ts` exposes `runOperator({ thread, message, itemId? })`. It must have two implementations behind one interface:

- **Real**: AI SDK + Anthropic, when `ANTHROPIC_API_KEY` is set and `MOCK_LLM` is not `1`.
- **Mock** (`MOCK_LLM=1` or no key): deterministic, rule-based. Split the message on `,`, `;`, ` and `, newlines. For each clause: if it ends with `?` → answer "I can't look that up in mock mode." (and in a per-item chat, append a short mock research note); else if it starts with a verb-like token or contains an imperative → create a task with title = clause with trailing date phrase removed, due date = `chrono-node` parse (forward dates, reference = today); if the clause mentions "note" → create in Notes; if it matches `email|mail|send` → create a pending `send_email` approval instead; otherwise treat as a thought → reply, save nothing. The mock must exercise every tool so the UI can be verified end to end without a key.

Both modes use the **same tool implementations** (`lib/operator/tools.ts`) so the mock is a faithful driver of the real code paths.

## 5. Data model (SQLite, Drizzle)

- `lists`: id (text, nanoid), name, kind (`tasks` | `notes` | `custom`), fieldsJson (custom field definitions, nullable), createdAt.
- `items`: id, listId, title, body (markdown, default ''), kind (`task` | `note`), checked (bool), dueDate (ISO date `YYYY-MM-DD`, nullable), dueTime (`HH:MM`, nullable), fieldsJson (custom field values), deletedAt (nullable), createdAt, updatedAt.
- `messages`: id, scope (`operator` | `item`), itemId (nullable), role (`user` | `assistant`), content, createdItemIdsJson (ids of items created by this assistant turn), createdAt.
- `approvals`: id, kind (`send_email` | `delete_items` | `bulk_update`), payloadJson, status (`pending` | `approved` | `rejected`), messageId (nullable), createdAt, resolvedAt.
- `outbox`: id, to, subject, body, sentAt (set when approved).
- `automations`: id, name, instruction, cron, enabled, lastRunAt, createdAt.
- `automation_runs`: id, automationId, startedAt, finishedAt, resultText, createdItemIdsJson.

Seed on first run: lists `Tasks` and `Notes`; 3 sample tasks; 1 sample automation (disabled): "Every morning at 8:00, create a task 'Review today's priorities'" (`0 8 * * *`).

## 6. Screens

- `/` — three-pane layout: left sidebar (lists + Trash + Outbox + Automations + "New list"), center = selected list's items (checkbox, title, due date chip, click opens item), right/bottom = operator chat thread (messages, created-item cards, approval cards with Approve/Reject). On mobile it stacks vertically; no horizontal scroll.
- `/lists/[id]` — same layout with that list selected.
- Item panel (drawer/modal) — editable title, due date, time, body (textarea), list selector, Delete; plus the per-item chat.
- `/automations` — table of automations with enable toggle, Run now, Add automation form (name, instruction, cron or preset dropdown), and last 10 runs.
- `/trash` — soft-deleted items with Restore.
- `/outbox` — approved emails (to, subject, body, sentAt).

Plain, clean Tailwind UI. No component library required.

## 7. API endpoints (Route Handlers under `app/api`)

- `GET /api/context` — lists, counts, due-today and overdue items (what the operator and MCP call first).
- `GET/POST /api/lists`, `PATCH/DELETE /api/lists/[id]`
- `GET /api/items?listId=&q=&changedSince=&includeDeleted=` , `POST /api/items` (array or single), `GET/PATCH/DELETE /api/items/[id]`, `POST /api/items/[id]/restore`
- `GET /api/search?q=` — keyword search over title+body (SQL LIKE; semantic search skipped).
- `POST /api/operator` `{ message, itemId? }` → `{ assistantMessage, createdItems, approvals }`; `GET /api/operator?itemId=` → message history for that scope.
- `GET /api/approvals`, `POST /api/approvals/[id]/approve`, `POST /api/approvals/[id]/reject`
- `GET/POST /api/automations`, `PATCH/DELETE /api/automations/[id]`, `POST /api/automations/[id]/run`, `GET /api/automations/[id]/runs`
- `GET /api/outbox`

## 8. Operator design (real mode)

System prompt includes: today's date and weekday (server local time, ISO), the user's lists (id, name, kind, fields), the 20 most relevant items (due today/overdue/in the current item scope), the Roma rules quoted above (to-do → task; question → answer; thought → reply and save nothing; due date is a day unless a time is stated; verb-first titles; default list is Tasks unless another is named; never delete or bulk-change or send anything without an approval), and the per-item scope when `itemId` is set ("you are working on this one item; prefer `update_items` on it").

Tools (zod schemas), all implemented in `lib/operator/tools.ts` against the DB directly:
- `get_context()` 
- `search({ query })`
- `create_items({ items: [{ title, kind, listId?, body?, dueDate?, dueTime?, fields? }] })` → returns created ids (normalize dates with chrono-node/`Date` to `YYYY-MM-DD`).
- `update_items({ updates: [{ id, title?, body?, checked?, dueDate?, dueTime?, listId?, fields? }] })` → if ≥5 updates, instead create a `bulk_update` approval and return `{ pendingApprovalId }`.
- `delete_items({ ids })` → always creates a `delete_items` approval, returns `{ pendingApprovalId }`.
- `web_search({ query })` → top 5 results (title, url, snippet) via duck-duck-scrape; graceful failure.
- `send_email({ to, subject, body })` → always creates a `send_email` approval, returns `{ pendingApprovalId }`.

Loop: up to 6 steps. After the loop, store the user and assistant messages (with the ids of items created in this turn) and return them. Approvals created during the turn are attached to the assistant message. When an approval is approved: `send_email` → insert into `outbox`; `delete_items` → set `deletedAt`; `bulk_update` → apply updates.

## 9. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real mode
ANTHROPIC_MODEL=claude-sonnet-4-5
MOCK_LLM=                     # set to 1 to force the rule-based mock operator
DATABASE_PATH=./data/roma.db
ROMA_API_URL=http://localhost:3000   # used by the MCP server
TZ=                           # optional, defaults to system
```

## 10. Skip

Auth/accounts, multi-user, mobile/Mac apps, voice and photo input, real Gmail/Calendar/Notion/Linear/Slack connections (the only outbound action is the mocked `send_email`), semantic search, offline capture/sync, body version history, Apple/Google sign-in, billing.

## 11. Acceptance checks (must all pass; run them and report the outputs)

1. `npm install` and `npm run build` succeed with zero TypeScript errors.
2. `MOCK_LLM=1 npm run dev` (or `npm start` after build) boots; `curl localhost:3000/` returns 200 and `GET /api/context` returns the seeded `Tasks` and `Notes` lists.
3. `POST /api/operator {"message":"call the dentist tomorrow, buy milk on friday, and what is the capital of Peru?"}` in mock mode creates 2 tasks (titles starting with "Call"/"Buy", correct `dueDate`s relative to today's date, both in Tasks) and the assistant message contains an answer/acknowledgement line for the question; `GET /api/items?listId=<tasks>` shows them.
4. `POST /api/operator {"message":"email bob@example.com that the report is late"}` creates a **pending approval** of kind `send_email` and nothing in `outbox`; `POST /api/approvals/<id>/approve` moves it to `outbox`.
5. `POST /api/lists {"name":"Reading","kind":"custom","fields":[{"name":"author","type":"text"}]}` works and `POST /api/items` into it with `fields.author` round-trips.
6. `DELETE /api/items/<id>` soft-deletes (item appears under `includeDeleted=1` with `deletedAt`), `POST /api/items/<id>/restore` restores it.
7. `POST /api/automations {"name":"Water plants","instruction":"create a task water the plants","cron":"* * * * *"}` then `POST /api/automations/<id>/run` creates a task and an `automation_runs` row.
8. `npm run mcp` starts the MCP server and responds to a JSON-RPC `tools/list` on stdin with the 7 tools (show the command and output; a tiny node script that writes `initialize` + `tools/list` to the process stdin is fine).
9. Run `npx tsc --noEmit` (or the build) once more at the end; `README.md`, `.env.example`, `.gitignore` present; `node_modules`, `.next`, `data/*.db` ignored.
