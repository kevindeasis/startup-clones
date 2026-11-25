# BUILD_PROMPT.md — exact prompts sent to the Sonnet build subagent

## Round 1 — initial build prompt (sent 2026-11-25)

```
You are building a working, runnable clone of the YC F26 startup Spacesheep inside the folder
/home/user/startup-clones/2026-11-25-spacesheep/ (call it <DIR>). The folder already contains SPEC.md,
BUILD_LOG.md and BUILD_PROMPT.md — do not modify or delete those three files. Everything else in <DIR> is yours.

INSTRUCTIONS
- Build the working end-to-end clone inside <DIR> exactly per the spec below. Aim for a real, runnable app, not a
  stub. Use the specified open-source libraries (Next.js 16, React 19, Tailwind v4, ai + @ai-sdk/anthropic, cheerio,
  diff, @modelcontextprotocol/sdk, zod) instead of reinventing them. Node v22 and npm are installed; the network
  proxy allows npm installs. Playwright + Chromium are pre-installed (require('playwright') works; do NOT run
  "playwright install").
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. Assume NO
  ANTHROPIC_API_KEY is present in this sandbox: the app must run in MOCK mode and the mock editor must make a
  visible, deterministic change so the smoke test passes.
- Add a `.gitignore` appropriate for the stack (node_modules, .next, out, .env and .env.*, except .env.example,
  data/, *.log, *.tsbuildinfo, next-env.d.ts, playwright screenshots).
- Verify it: `npm install`, `npm run build`, `npm run lint` (tsc --noEmit), then start the app on a free port
  (e.g. `PORT=3111 npm start` in the background), run `BASE_URL=http://localhost:3111 npm run smoke` and make every
  acceptance check in the spec pass. Also take one Playwright screenshot of `/` and of `/s/<slug>` and check the
  browser console for errors. Fix errors before finishing. Do not claim it works unless you actually ran it.
  Stop any background server when done, and delete `data/` before you finish so no runtime data is left behind.
- Write a thorough `README.md` in <DIR>: what the original company does (link https://spacesheep.dev/ and
  https://www.ycombinator.com/companies/spacesheep), what this clone does and what it skips, architecture summary,
  the GitHub tools used (with links), exact setup and run steps (including the `claude mcp add` command and the
  deploy CLI), environment variables, how mock mode works, known limitations, and the next 3 things to build.
  State clearly that it is an independent learning clone not affiliated with Spacesheep.
- Do not modify anything outside <DIR>. Do not run git commit or git push.
- When done, report back: what was built (file list), exactly which verification commands you ran and their
  results (paste the smoke output), anything that does not work, and your total input/output token usage.

SPEC (full contents of <DIR>/SPEC.md follow)
-------------------------------------------
# SPEC — Paddock, an independent learning clone of Spacesheep (2026-11-25)

Original company: **Spacesheep** (YC Fall 2026) — https://spacesheep.dev/ — YC profile https://www.ycombinator.com/companies/spacesheep — Product Hunt launch https://www.producthunt.com/products/spacesheep

Spacesheep calls itself "a shared workspace for people and their AI agents". A coding agent
(Claude Code, Codex, Cursor, ChatGPT, …) publishes an HTML page ("space") to a private URL via an
MCP server, a CLI (`npx spacesheep deploy <file>`) or a REST API. Teammates open the space in the
browser, pin a comment to a specific block, and if the comment mentions `@spacesheep` the built-in
AI rewrites only that spot while everybody watches. Every edit is saved as a version; the comment
card shows what changed and has an Undo button; older versions can be restored. Spaces can be
private or public, shared by link, and searched by their content.

This clone (working name **Paddock**) is an independent learning project, not affiliated with
Spacesheep. It implements the core loop: agent publishes → people comment → `@paddock` edits the
targeted block → version history with undo/restore → share & search.

## Core user flows (implement all five)

1. **Agent publishes a space.** Two entry points, both backed by the same REST API:
   - `POST /api/spaces` with header `Authorization: Bearer <PADDOCK_API_KEY>` and JSON
     `{ title, html, visibility?: "private"|"public", slug? }` → creates space + version 1, returns
     `{ id, slug, url, version }`.
   - `POST /api/spaces/:id/versions` (same auth) with `{ html, note? }` → new version.
   - An **MCP server** (stdio) at `mcp/server.mjs` exposing tools `create_space`, `create_version`,
     `list_spaces`, `get_space`, `list_comments`, `reply_comment`, `restore_version`. It calls the
     REST API over HTTP using `PADDOCK_URL` (default `http://localhost:3000`) and `PADDOCK_API_KEY`.
     README must show the `claude mcp add paddock -- node mcp/server.mjs` command.
   - A tiny CLI `scripts/deploy.mjs <file.html> [--title ...] [--public]` that mimics
     `npx spacesheep deploy` and prints the share URL.
2. **People read and comment.** `/s/[slug]` renders the space's current HTML in a sandboxed
   `<iframe srcdoc>` (`sandbox="allow-scripts"`, no same-origin). A small injected script inside the
   srcdoc highlights blocks on hover and `postMessage`s the clicked block id to the parent. The
   right-hand panel shows comment threads (pinned to a block or on the whole space), lets a user
   type a display name (stored in localStorage, no auth) and post a comment, resolve/reopen a
   thread, and shows version history.
3. **`@paddock` edits the exact spot.** If a new comment contains `@paddock` (case-insensitive;
   also accept `@spacesheep` as an alias), the server runs the AI edit pipeline (below) on the
   pinned block (or on the whole document if the comment is not pinned), stores the result as a
   new version, and posts an **agent reply** in the thread that contains: a one-sentence summary,
   a compact diff of the changed text (unified diff of the block's text, max ~40 lines), and the
   version number it created. The UI shows an **Undo** button on that reply that calls
   `POST /api/spaces/:id/versions/:n/restore` with the previous version → creates a new version
   (nothing is ever deleted). Viewers poll `GET /api/spaces/:id?since=<version>` every 3 s and
   reload the iframe when the version changes so "everyone sees it live".
4. **Versions.** `GET /api/spaces/:id/versions` lists versions (number, created_at, author
   `agent|ai|user:<name>|restore`, note). The viewer can select an older version to preview it in
   the iframe and click **Restore** (creates a new version whose content equals the old one).
5. **Dashboard, share and search.** `/` lists spaces (title, slug, visibility, version count,
   updated), has a "New space" form (title + paste HTML, or pick one of 3 bundled sample spaces:
   a design doc, a dashboard with an inline SVG chart, a landing-page mockup), a search box
   (`GET /api/search?q=` — case-insensitive keyword search over title + text extracted from the
   current HTML with cheerio; rank by match count), a visibility toggle (private/public) and a
   copy-link button. Private spaces are still viewable by URL (no auth in this clone) but are
   excluded from public search results; the dashboard shows the badge.

## Stack

- **Next.js 16 (App Router) + TypeScript + React 19**, Tailwind v4 for styling. Scripts:
  `dev`, `build`, `start` (both honour `PORT`), `lint` (= `tsc --noEmit`), `smoke`.
- **Vercel AI SDK** `ai` + `@ai-sdk/anthropic` for the LLM call (`generateText`, model
  `claude-sonnet-5-5` by default via `PADDOCK_MODEL`). Provider: Anthropic via
  `ANTHROPIC_API_KEY`. **If the key is missing, run in MOCK mode** (banner in the UI) with a
  deterministic fake editor: it applies the instruction in a visible, testable way — rewrite the
  block's text to `<instruction applied>` form (e.g. if the instruction contains "shorter" keep the
  first sentence; if it contains "title case"/"uppercase" transform the text; otherwise prepend
  "[edited: <first 60 chars of instruction>] " to the block's first text node). The mock must
  always change the block so the diff is non-empty.
- **cheerio** for server-side HTML work: assign stable `data-block="b<N>"` ids to block elements
  when a version is stored (h1–h6, p, li, blockquote, pre, table, figure, img, section/article/
  div that have direct text or are leaf containers), extract plain text for search and diffs,
  and swap the targeted block's outerHTML with the model's replacement.
- **diff** (jsdiff, `createTwoFilesPatch`/`diffLines`) to produce the change summary in the agent
  reply.
- **@modelcontextprotocol/sdk** (`McpServer` + `StdioServerTransport`) for `mcp/server.mjs`;
  **zod** for tool input schemas and API validation.
- **Storage:** JSON files under `data/` (gitignored) via a small `lib/store.ts` with synchronous
  read/write and an in-process mutex per space: `data/spaces/<id>.json` holds
  `{ id, slug, title, visibility, created_at, updated_at, versions: [...], comments: [...] }`.
  Version objects: `{ n, html, text, author, note, created_at }`. Comment objects:
  `{ id, block, author, body, created_at, resolved, parent_id?, kind: "user"|"agent",
  meta?: { version_created, previous_version, diff, summary } }`. No database server needed.
- **No auth/billing/teams/Slack/Drive sync** (see Skip).

## Screens / endpoints

Pages: `/` (dashboard), `/s/[slug]` (viewer + comments + versions), `/new` can be part of `/`.

API (all JSON; write endpoints that come from agents require the Bearer key; comment/visibility
endpoints used by the browser UI do not require the key in this clone):
- `GET /api/health` → `{ ok: true, mock: boolean, model }`
- `GET /api/spaces` (list, optional `?q=`) · `POST /api/spaces` (auth)
- `GET /api/spaces/:id` (`?since=n` returns `{ changed: boolean, version }` cheaply; also accept slug)
- `PATCH /api/spaces/:id` `{ title?, visibility? }`
- `GET /api/spaces/:id/versions` · `POST /api/spaces/:id/versions` (auth) · `GET /api/spaces/:id/versions/:n` (html) · `POST /api/spaces/:id/versions/:n/restore`
- `GET /api/spaces/:id/comments` · `POST /api/spaces/:id/comments` `{ block?, author, body, parent_id? }` (triggers AI edit when `@paddock`/`@spacesheep` present; returns the comment and, when triggered, the agent reply) · `PATCH /api/spaces/:id/comments/:cid` `{ resolved }`
- `GET /api/search?q=` (public spaces + all spaces when `?all=1`, used by the dashboard)
- `GET /api/raw/:slug` → serves the current HTML with `Content-Type: text/html` (used by the iframe fallback and by curl checks).

## LLM pipeline (`lib/editor.ts`)

Input: full document HTML, target block id (or null), the comment body, and the last 5 comments
of the thread for context. Steps:
1. With cheerio, extract `targetHtml = $('[data-block="bN"]').toString()` (or `<body>` inner HTML
   when no block) and a 1,500-char window of surrounding text for context.
2. Prompt (system): "You are Paddock, an editor embedded in a shared HTML document. Rewrite ONLY
   the given HTML fragment according to the instruction. Keep the same outer tag and the
   `data-block` attribute. Keep inline styles/classes unless asked. Return a JSON object
   `{ "html": "...", "summary": "..." }` and nothing else." User message: instruction, the
   fragment, the surrounding context. Use `generateText` with low temperature and parse JSON
   (strip code fences; on parse failure retry once, then fall back to using the raw text as html
   if it starts with `<`).
3. Validate: the replacement must parse and contain the same `data-block` id (re-add if dropped);
   reject if empty.
4. Replace the block in the document, re-run block-id assignment (ids for untouched blocks must
   stay the same: assign ids only to elements that lack one, continuing from the max), store a new
   version with `author: "ai"`, `note: "@paddock: <instruction>"`.
5. Build the diff from the old vs new **text** of the block (jsdiff), post the agent reply with
   `meta: { version_created, previous_version, diff, summary }`.
Mock mode replaces step 2 with the deterministic transform described above (summary:
`"Mock edit: <instruction>"`).

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # optional; absent → MOCK mode
PADDOCK_MODEL=claude-sonnet-5-5
PADDOCK_API_KEY=dev-key       # bearer key agents use to publish; default "dev-key" in dev when unset
PADDOCK_URL=http://localhost:3000   # used by mcp/server.mjs and scripts/deploy.mjs
PORT=3000
```

## Skip

Auth/accounts, teams, billing, OAuth for MCP, Slack/Telegram/WhatsApp channels, Google Drive/
GitHub sync, custom domains, PDF export, signatures, semantic search (keyword only), real-time
websockets (polling is fine), folder/multi-file spaces (single HTML file per version only).

## Acceptance checks (`scripts/smoke.mjs`, run against a started server, must all pass)

1. `GET /api/health` → 200, `mock` is boolean.
2. `POST /api/spaces` without bearer → 401; with `Bearer dev-key` → 201 with `slug`, version 1.
3. `GET /api/raw/:slug` → 200, `text/html`, body contains `data-block="b1"`.
4. `GET /s/:slug` → 200 HTML page containing the space title.
5. `POST /api/spaces/:id/comments` with `{ block: "b1", author: "Kevin", body: "looks good" }` → 201, no agent reply.
6. `POST .../comments` with `{ block: "b2", author: "Kevin", body: "@paddock make this shorter" }` → 201, response includes an agent reply with `meta.version_created === 2` and a non-empty `diff`; `GET /api/raw/:slug` now differs from version 1 but still contains `data-block="b1"` and `data-block="b2"`.
7. `GET /api/spaces/:id/versions` → 2 entries; `GET .../versions/1` returns the original HTML.
8. `POST .../versions/1/restore` → version 3 whose html equals version 1 html.
9. `POST /api/spaces/:id/versions` (auth) with new html → version 4; `GET /api/spaces/:id?since=3` → `{ changed: true, version: 4 }`.
10. `PATCH /api/spaces/:id` `{ visibility: "public" }` → 200; `GET /api/search?q=<word from the html>` includes the space; a second private space with the same word is excluded unless `&all=1`.
11. `GET /api/spaces/:id/comments` → 3 comments (2 user, 1 agent); `PATCH .../comments/:cid { resolved: true }` → resolved.
12. `node scripts/deploy.mjs samples/design-doc.html --title "Deploy test"` prints a URL that returns 200.
13. `node mcp/server.mjs` responds to a JSON-RPC `initialize` + `tools/list` over stdio with the 7 tools (the smoke test may spawn it and check the tool names).
14. `npm run build` and `npm run lint` succeed with zero errors.
Also: Playwright (pre-installed) screenshot of `/` and `/s/:slug` renders without console errors
(optional in smoke, but the builder must do it once and mention the result in the README).
```

## Round 2 — fix prompt (sent 2026-11-25 after the main agent's review)

```
Review result for Paddock (/home/user/startup-clones/2026-11-25-spacesheep): I re-ran `npm run lint`, `npm run build`,
started the server on port 3123, ran `npm run smoke` (13/13 PASS) and a Playwright pass (dashboard, viewer, click block b2,
post "@paddock make this uppercase" -> version 2, diff, Undo; zero console errors). Good work. One focused fix:

1. Block ids are not validated. `POST /api/spaces/:id/comments` with `{"block":"b1\"] , [x=\"","author":"t","body":"@paddock hi"}`
   returns 201, stores the garbage block id on the comment, and `runEdit` silently falls back to editing the WHOLE document
   (hasBlock() is false -> block = null). Fix: in the comments route zod schema, require `block` to match /^b\d+$/ when
   present (return 400 "Invalid block id" otherwise), and if the block id is well-formed but does not exist in the current
   version, return 400 "Unknown block" instead of editing the whole document. Apply the same regex in the MCP
   `reply_comment` tool schema (z.string().regex(/^b\d+$/)). Whole-document edits must still work when `block` is omitted/null.
2. Add a smoke check (number it 11b or 14) that posts a comment with a malformed block id and expects 400, and one with
   `block: "b999"` expecting 400, and keep all existing checks passing.

Then: `npm run lint`, `npm run build`, start the server on a free port, run the smoke suite, paste the output, stop the
server, delete `data/`. Do not touch SPEC.md, BUILD_LOG.md or BUILD_PROMPT.md. Do not commit. Report the exact commands and
results.
```
