# Paddock - an independent learning clone of Spacesheep

> Independent learning project. **Not affiliated with, endorsed by or derived from the code of Spacesheep.** Built from public descriptions only.

## The original

[Spacesheep](https://spacesheep.dev/) (YC Fall 2026, [YC profile](https://www.ycombinator.com/companies/spacesheep), [Product Hunt](https://www.producthunt.com/products/spacesheep)) is "a shared workspace for people and their AI agents". A coding agent (Claude Code, Codex, Cursor, ChatGPT...) publishes an HTML page ("space") to a private URL through an MCP server, a CLI (`npx spacesheep deploy <file>`) or a REST API. Teammates open it, pin a comment to a block, and a comment mentioning `@spacesheep` makes the built-in AI rewrite only that spot while everyone watches. Every edit is a version with a diff and an Undo button.

## What this clone does (Paddock)

- Agents publish HTML via REST (`POST /api/spaces`, bearer key), an stdio MCP server (`mcp/server.mjs`, 7 tools) or a CLI (`scripts/deploy.mjs`).
- `/s/[slug]` renders the space in a sandboxed `<iframe srcdoc sandbox="allow-scripts">`; an injected script highlights blocks on hover and posts the clicked `data-block` id to the parent.
- Comment threads pinned to a block or the whole space, display name in localStorage, resolve/reopen.
- `@paddock` (or `@spacesheep`) in a comment runs the AI edit pipeline on that block only, stores a new version (`author: ai`), and posts an agent reply with summary, unified text diff and the version number, plus an **Undo** button (a restore creates a new version; nothing is deleted).
- Version history, preview of older versions, Restore.
- Viewers poll `GET /api/spaces/:id?since=n` every 3 s and reload on change.
- Dashboard: list, New space form (paste HTML or 3 bundled samples: design doc, SVG dashboard, landing page), keyword search ranked by match count, private/public toggle, copy link.

**Skipped:** auth/accounts, teams, billing, OAuth for MCP, Slack/Telegram/WhatsApp, Drive/GitHub sync, custom domains, PDF export, signatures, semantic search, websockets (polling instead), multi-file spaces.

## Architecture

- Next.js 16 App Router + React 19 + Tailwind v4, TypeScript.
- `lib/store.ts`: JSON files in `data/spaces/<id>.json` (gitignored), synchronous fs, per-space in-process promise mutex.
- `lib/html.ts` (cheerio): stable `data-block="bN"` ids (only assigned to elements lacking one, continuing from max), text extraction, block extraction/replacement.
- `lib/editor.ts`: the `@paddock` pipeline: extract block + 1,500-char context, call `generateText` (low temperature, JSON parse with one retry and raw-HTML fallback), validate/keep `data-block`, replace block, store version, build a jsdiff patch of block text (max 40 lines), post agent reply. Mock mode replaces the LLM call.
- `lib/search.ts`: case-insensitive keyword match count over title + current text.
- `app/api/**`: route handlers with zod validation. Write endpoints for agents need `Authorization: Bearer $PADDOCK_API_KEY` (default `dev-key`); browser comment/visibility endpoints are unauthenticated in this clone.
- `mcp/server.mjs`, `scripts/deploy.mjs`: thin HTTP clients of the REST API.

## GitHub tools used

- [vercel/next.js](https://github.com/vercel/next.js), [facebook/react](https://github.com/facebook/react), [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)
- [vercel/ai](https://github.com/vercel/ai) (`ai` + `@ai-sdk/anthropic`)
- [cheeriojs/cheerio](https://github.com/cheeriojs/cheerio)
- [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff) (`diff`)
- [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [colinhacks/zod](https://github.com/colinhacks/zod)
- [microsoft/playwright](https://github.com/microsoft/playwright) (verification screenshots only; pre-installed, not a dependency)

## Setup and run

```bash
cd 2026-11-25-spacesheep
cp .env.example .env.local      # optional; works with no keys (mock mode)
npm install
npm run build
PORT=3000 npm start             # or: npm run dev
```

Open http://localhost:3000. Click a sample, click a block in the page, type a comment such as `@paddock make this shorter`.

Publish from the CLI (mimics `npx spacesheep deploy`):

```bash
PADDOCK_URL=http://localhost:3000 node scripts/deploy.mjs samples/design-doc.html --title "My doc" [--public]
```

Register the MCP server with Claude Code:

```bash
claude mcp add paddock -e PADDOCK_URL=http://localhost:3000 -e PADDOCK_API_KEY=dev-key -- node mcp/server.mjs
```

(from this folder; use an absolute path to `mcp/server.mjs` otherwise). Tools: `create_space`, `create_version`, `list_spaces`, `get_space`, `list_comments`, `reply_comment`, `restore_version`.

Verify: `npm run lint` (tsc --noEmit), then with the server running `BASE_URL=http://localhost:3000 npm run smoke`.

## Environment variables

| Name | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | enables the real LLM editor | unset = MOCK mode |
| `PADDOCK_MODEL` | model id | `claude-sonnet-5-5` |
| `PADDOCK_API_KEY` | bearer key for agent write endpoints | `dev-key` |
| `PADDOCK_URL` | base URL for MCP server and deploy CLI | `http://localhost:3000` |
| `PORT` | server port | `3000` |

Next.js loads `.env.local` automatically for the app; the MCP server and CLI read the real process environment (pass `-e` or export vars).

## Mock mode

With no `ANTHROPIC_API_KEY`, `/api/health` returns `mock: true` and the UI shows an amber banner. The fake editor is deterministic: "shorter" keeps the first sentence; "title case" / "uppercase" transform the text; anything else prepends `[edited: <first 60 chars of instruction>] ` to the first text node. If a transform would not change the block (e.g. already one sentence), it falls back to the prepend so the diff is never empty. Summary is `Mock edit: <instruction>`.

## Verification done

On Node 22: `npm install`, `npm run build`, `npm run lint` clean; `PORT=3111 npm start` + `BASE_URL=http://localhost:3111 npm run smoke` passed 13/13 checks (check 14 is build+lint). A Playwright screenshot of `/` and `/s/<slug>`, including clicking a block and posting an `@paddock title case` comment, showed the diff, Undo button and version 2, with zero console errors. The real-LLM path (`generateText` with Anthropic) is written but was **not** exercised (no API key in the sandbox).

## Known limitations

- No auth: anyone with a URL can comment, restore or toggle visibility; the dashboard sends the public dev key.
- Storage is single-process JSON files; not safe for multiple server instances or serverless.
- Block ids are assigned by heuristic; a model that rewrites a block's inner structure may drop nested ids, which are re-assigned as new ids.
- Polling reload resets iframe scroll position.
- Scripts inside a space run (sandboxed, no same-origin) which is intentional but not hardened beyond the sandbox attribute.
- `public/samples/` duplicates `samples/` so the dashboard can fetch them.

## Next 3 things to build

1. Real auth, per-space share tokens and a real private/public access model.
2. Streaming edits (stream the replacement into the iframe) with presence indicators over SSE/websockets.
3. Replace JSON files with SQLite/Postgres, plus semantic search and multi-file spaces.
