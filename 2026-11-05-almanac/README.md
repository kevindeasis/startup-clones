# Company Brain (an Almanac clone)

A local-first web app + CLI that turns a pile of company documents into a self-updating, **cited Markdown wiki**, plus an agent that always reads the wiki first.

## The original: Almanac (YC S26)

[Almanac](https://usealmanac.com) ("the agent with a company brain") connects to your work accounts (Gmail, Calendar, Granola, GitHub, Slack, PostHog...), pre-compiles everything into a wiki of Markdown pages (a personal wiki and a shared company wiki), recompiles it about daily, cites a source for every statement, lets the user correct it, and has its agent read the wiki before every task. A background worker proposes tasks it could do, and other agents (Claude Code, Codex) can read the same Markdown via a CLI. Launch HN: <https://news.ycombinator.com/item?id=49511007>. Launch YC: <https://www.ycombinator.com/launches/Rdq-almanac-the-agent-with-a-company-brain>.

## What this clone does

All five core flows from `SPEC.md` work end to end:

1. **Ingest sources**: paste text, upload files (`.md .txt .json .csv`), or click "Load sample company" (11 fake docs for "Northwind Robotics" in `samples/`: meeting notes, emails, investor update, roadmap, Slack-export JSON, postmortem, CSV pipeline, glossary). Sources are stored verbatim in `data/sources/<id>.json`.
2. **Compile the wiki** (`POST /api/compile`, button, or CLI): incremental, only uncompiled sources are processed. Extract (one LLM call per source, zod-validated JSON, one retry) -> merge (one call per affected page) -> deterministic timeline -> overview rebuilt last -> suggestions. Pages: `overview.md`, `people/*.md`, `projects/*.md`, `decisions.md`, `open-loops.md`, `timeline.md`, `glossary.md`, each with YAML frontmatter and `[src:N]` citations. Runs are logged to `data/compile-log.json` (with token usage).
3. **Browse and correct**: tree + rendered Markdown, `[src:N]` chips open the raw source in a drawer, Edit mode saves with `human_edited: true`. The compiler passes human-written lines to the LLM ("keep unless contradicted") and, as a code-level safety net, re-appends any human line the model dropped under "## Human notes".
4. **Chat**: streaming (`streamText` + `useChat`). Context = `overview.md` + top-4 pages by BM25-lite score + all page titles (+ raw source if the question mentions `src:N`). Chats persist to `data/chats/*.json`; citations are clickable.
5. **Proactive tasks**: after each compile (and via `POST /api/suggest`) the worker proposes 3-6 `{title, why, draft}` tasks from `open-loops.md` and recent sources; Done / Dismiss persisted in `data/tasks.json`. Existing open/done titles are skipped.

CLI (`commander`, same library code): `npm run brain -- ingest <file...>`, `compile`, `ask "<q>"`, `wiki ls`, `wiki cat <page>`.

### Skipped (per spec)
Auth / multi-user, billing, OAuth integrations (Gmail, Calendar, Granola, GitHub, Slack, PostHog live sync), the agent's computer/browser, sending email or acting externally (drafts only), iMessage, desktop app, scheduled daily recompile (cron the `compile` CLI command), vector search, PDF/DOCX parsing.

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind 4)
  Home / Sources / Wiki / Chat  --fetch--> /api/* route handlers
                                              |
                          src/lib/brain/  (compile, suggest, chat, ingest, prompts, llm, mock)
                                              |
                          src/lib/store.ts  -> data/ (files only, no DB)
                                  sources/<id>.json  wiki/**/*.md  chats/*.json  tasks.json  compile-log.json
CLI (src/cli.ts, tsx) ----------------------^ same lib code
```

Data flow of a compile: `uncompiled sources -> extract (generateText -> JSON -> zod) -> group facts by target page -> merge per page (generateText, current page + new facts + rules) -> write page + frontmatter -> timeline table (code) -> overview (generateText) -> mark sources compiledAt -> suggest() -> append CompileRun`.

Key files: `src/lib/brain/prompts.ts` (all prompts), `compile.ts`, `suggest.ts`, `chat.ts` (retrieval), `llm.ts` (provider selection), `mock.ts` (offline model), `src/lib/store.ts` (file storage), `src/app/api/**` (routes), `src/app/components/*` (UI).

## Open-source tools used

- Vercel AI SDK, <https://github.com/vercel/ai>: `ai@6.0.323` (`generateText`, `streamText`, `convertToModelMessages`, `ai/test` `MockLanguageModelV3`), `@ai-sdk/anthropic@3.0.138`, `@ai-sdk/react@3.0.326` (`useChat`). Versions pinned exactly.
- Next.js 16, <https://github.com/vercel/next.js>
- zod v4, <https://github.com/colinhacks/zod>
- gray-matter, <https://github.com/jonschlinkert/gray-matter> (frontmatter)
- react-markdown, <https://github.com/remarkjs/react-markdown> and remark-gfm, <https://github.com/remarkjs/remark-gfm> (tables)
- commander, <https://github.com/tj/commander.js> (CLI)
- tsx, <https://github.com/privatenumber/tsx> (run the CLI)
- Tailwind CSS 4, <https://github.com/tailwindlabs/tailwindcss>

## Setup and run

Requires Node 20+ (developed on Node 22).

```bash
npm install
cp .env.example .env        # optional; leave ANTHROPIC_API_KEY empty for mock mode
npm run build && npm run start      # or: npm run dev     (http://localhost:3000)
```
Then open the app: Sources -> "Load sample company" -> "Compile wiki" -> browse Wiki, ask in Chat, see tasks on Home.

CLI (shares `data/` with the app):
```bash
npm run brain -- ingest samples/*.md
npm run brain -- compile
npm run brain -- ask "what is the company working on"
npm run brain -- wiki ls
npm run brain -- wiki cat projects/atlas.md
```

## Environment variables

| Var | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Real LLM calls. Empty/missing means mock mode. |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-5-5`. |
| `LLM_PROVIDER` | `anthropic` (default when key present) or `mock` (forces mock). |
| `DATA_DIR` | Default `./data`. |

## Mock mode

If `ANTHROPIC_API_KEY` is missing or `LLM_PROVIDER=mock`, `getModel()` returns a `MockLanguageModelV3` (from `ai/test`) instead of the Anthropic model. Everything else is identical: the same `generateText`/`streamText` calls run, and the mock inspects the `[[STEP:...]]` tag in the system prompt to answer deterministically: heuristic extraction (names from `Attendees:/From:/Owner:` lines and Slack users, `Project X` mentions, `Decision:`/`Action item:`/`Term:` lines, ISO dates), page merging that dedupes and inserts facts, overview, 3-6 tasks from open loops, and a streamed chat answer built from cited wiki lines most relevant to the question. A yellow banner shows in the UI. The mock is tuned to the sample docs and is far dumber than Claude on arbitrary text.

## Assumptions

- Single user, single company, local disk; no concurrency control on `data/` files.
- Source ids are max+1; deleting a source does not remove facts already compiled into the wiki (recompile-from-scratch is not implemented).
- JSON output is requested in the prompt and validated with zod (not `Output.object`), with one retry.
- `[src:N]` is the only citation syntax; a page's frontmatter `sources` lists all ids cited.
- `human_blocks` frontmatter (lines the user wrote) is an addition to the spec's schema, used to protect human edits.

## Known limitations

- Conflict detection (human edit vs new source -> line in `open-loops.md`) relies on the LLM; the mock never produces conflicts.
- Real-Claude path is untested: no API key was available in the build environment (type-checked and wired, not executed).
- The mock sometimes creates noisy facts (CSV rows, raw sentences) and a few entities that are not people; timeline events can duplicate across sources.
- Large sources are sent whole to the extract call (no chunking); compile runs inside one HTTP request.
- `next build` prints a Turbopack warning about dynamic filesystem access in `store.ts` (harmless).
- `@ai-sdk/provider` is imported for a type only (comes transitively with `ai`).
- Deleting a source from the UI does not delete wiki pages; `/api/sources` DELETE uses `?id=`.

## Next 3 things to build

1. Full recompile / source-removal: rebuild pages from scratch and drop facts whose sources were deleted.
2. Real connectors (Gmail, Slack, GitHub, Granola) via OAuth that feed the same `ingest` path, plus a scheduled daily compile.
3. Evaluation and trust: a citation checker that verifies each `[src:N]` claim against the source text, a visible conflicts queue, and embedding-based retrieval for larger wikis.
