# BUILD_PROMPT.md — prompts sent to the Sonnet build subagent (verbatim, in order)

## Round 1 — initial build prompt (2026-11-05T06:15:20Z)

You are a senior full-stack engineer. Build a working end-to-end clone of the YC startup Almanac ("Company Brain") inside the folder `/home/claude/startup-clone/2026-11-05-almanac/` exactly per the spec below. The folder already contains SPEC.md, BUILD_PROMPT.md and BUILD_LOG.md — do not delete or rewrite those three files.

## Instructions

- Build the working end-to-end clone exactly per the spec. Aim for a real, runnable app, not a stub. Use the specified open-source libraries instead of reinventing them. Pin the AI SDK versions exactly as the spec says (`ai@6.0.323`, `@ai-sdk/anthropic@3.0.138`, `@ai-sdk/react@3.0.326`); read `node_modules/ai/dist/index.d.ts` and `node_modules/ai/test/dist/index.d.ts` if you are unsure about an API (e.g. `MockLanguageModelV3`, `streamText`, `toUIMessageStreamResponse`, `convertToModelMessages`, `Output`).
- Read all API keys from environment variables and ship a `.env.example`. Never commit real secrets. There is NO `ANTHROPIC_API_KEY` in this environment, so you must verify everything in mock mode; the mock must exercise the real code paths (same `generateText`/`streamText` calls, just a mock model).
- Add a `.gitignore` appropriate for the stack (node_modules, .next, .env, build output, `data/*` except `data/.gitkeep`).
- Verify it: `npm install`, `npm run build`, run any tests, start the app (`npm run start` on a free port, or `npm run dev`) and exercise every acceptance check in section 9 of the spec with `curl` (and Playwright screenshot if available — `require('playwright')` works globally, do not reinstall it). Fix errors before finishing. Do not claim something works unless you actually ran it. Kill any servers you started when done.
- Write a thorough `README.md` in the folder: what the original company does (with link to https://usealmanac.com and the Launch HN https://news.ycombinator.com/item?id=49511007), what this clone does and what it skips, architecture summary (components and data flow), the GitHub tools used (with links), exact setup and run steps, environment variables, how mock mode works, known limitations, and the next 3 things to build. State assumptions clearly.
- Do not modify anything outside `/home/claude/startup-clone/2026-11-05-almanac/`. Do not commit or push (no git commands that change state).
- Keep the UI simple but polished: left nav (Home / Sources / Wiki / Chat), Tailwind, readable on a laptop. A visible banner when in mock mode.
- Work efficiently: avoid reading huge files; prefer writing complete files in one go; don't over-engineer.
- Report back at the end with: (1) what was built (file tree summary), (2) exactly which verification commands you ran and their results (paste key outputs), (3) each acceptance check 1–10 with PASS/FAIL, (4) anything that does not work or was deviated from the spec and why, (5) your total input/output token usage as best you can determine.

## SPEC.md (verbatim)

# SPEC — Almanac clone ("Company Brain")

Date: 2026-11-05 · Original company: **Almanac (YC S26)** — https://usealmanac.com · Launch HN: https://news.ycombinator.com/item?id=49511007 · Launch YC: https://www.ycombinator.com/launches/Rdq-almanac-the-agent-with-a-company-brain

## 1. What the original product does

Almanac is "the agent with a company brain". You connect your work accounts (Gmail, Calendar, Granola meeting notes, GitHub, Slack, PostHog…). Almanac **pre-compiles** everything it ingests into a **wiki of Markdown pages** — a personal wiki (your preferences, people you deal with, what you're on) and a shared company wiki (what the company does, projects, roadmap, blockers, decisions). The wiki is recompiled about once a day, every statement carries a **source citation**, and the user can correct it. The agent **reads the wiki before every task**, so you never have to re-explain your business. A **background worker** looks at the wiki and proposes tasks it could do ("I already drafted the follow-up to X"). Other agents (Claude Code, Codex) can read the same Markdown wiki to get up to speed via a CLI. Paid at $20/user/month after a 7-day trial.

## 2. What the clone implements (the "thin layer" we are reproducing)

Working name: **Company Brain**. A local-first web app + CLI that turns a pile of company documents into a self-updating, cited Markdown wiki, and gives you an agent that always reads the wiki first.

### Core user flows (implement all 5)

1. **Ingest sources** — Upload or paste text sources (Markdown, plain text, meeting notes, email threads as text, a Slack-export-style JSON `[{user, text, ts}]`, CSV). Each source gets an id, title, kind, timestamp, and is stored verbatim. A "Sources" screen lists them with a delete button. Also a `samples/` folder with 8–12 realistic fake documents for a fictional company (e.g. "Northwind Robotics": meeting notes, investor update, customer emails, a roadmap doc, a Slack channel export, an incident postmortem) and a one-click "Load sample company" button.
2. **Compile the wiki** — A "Compile wiki" action (button + `POST /api/compile` + CLI) runs the compile pipeline (section 6). It produces/updates Markdown pages under `data/wiki/` in fixed categories: `overview.md`, `people/*.md`, `projects/*.md`, `decisions.md`, `open-loops.md`, `timeline.md`, `glossary.md`. Every page has YAML frontmatter (`title, kind, updated, sources: [ids]`) and every fact paragraph ends with a citation like `[src:3]`. Compilation is **incremental**: only sources added since the last compile are passed as "new material", together with the current page contents, and the LLM returns the updated page. A compile log (`data/compile-log.json`) records each run (time, sources processed, pages changed, tokens if available).
3. **Browse & correct the wiki** — A "Wiki" screen: sidebar tree of pages, Markdown rendering, each `[src:N]` citation is a link that opens the source in a drawer. An "Edit" mode lets the user edit page Markdown directly; saved edits are marked `human_edited: true` in frontmatter and the compiler must preserve human edits (pass them to the LLM with an instruction to keep them unless new sources contradict them, in which case flag it in `open-loops.md`).
4. **Chat with the brain** — A "Chat" screen with streaming responses. Before answering, the server builds context by (a) always including `overview.md`, (b) selecting the top-K relevant wiki pages by a simple lexical score (BM25-lite or keyword overlap over page text — no vector DB), (c) optionally pulling the raw source for any citation the user asks about. The system prompt tells the model to answer only from the wiki, cite `[src:N]`, and say "the wiki doesn't cover this" otherwise. Conversations are persisted in `data/chats/*.json`. Citations in answers are clickable like in the wiki.
5. **Proactive tasks (background worker)** — A "Home" screen that shows **suggested tasks** derived from `open-loops.md` and recent sources: the worker (`POST /api/suggest`, also run automatically after each compile) asks the LLM for 3–6 concrete tasks `{title, why, draft}` where `draft` is a ready-to-send draft (email reply, follow-up message, checklist). The user can mark a task Done or Dismiss it; state lives in `data/tasks.json`. The home screen also shows "last compiled at", source count, and page count.

### CLI (bonus, small)
`npm run brain -- <cmd>` using `commander`: `ingest <file...>`, `compile`, `ask "<question>"`, `wiki ls`, `wiki cat <page>`. The CLI reuses the same library code as the API routes. This mirrors Almanac's "other agents can read the wiki" angle: any agent can simply read `data/wiki/*.md`.

## 3. Stack (fixed)

- **Next.js 16 (App Router) + TypeScript + React 19**, Tailwind CSS for styling (keep styling simple and clean; a left nav with Home / Sources / Wiki / Chat).
- **Vercel AI SDK v6**: pin exactly `ai@6.0.323`, `@ai-sdk/anthropic@3.0.138`, `@ai-sdk/react@3.0.326` (these three are mutually compatible; do NOT use ai v7). Use `generateText` for compile/suggest steps (ask for JSON in the prompt and parse with zod, or use `Output.object` if available in this version — check `node_modules/ai/dist/index.d.ts`), `streamText` + `toUIMessageStreamResponse()` for chat, and `useChat` from `@ai-sdk/react` on the client.
- **Anthropic** as the default provider: `anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5")` via `ANTHROPIC_API_KEY`.
- **Mock provider for offline verification**: if `ANTHROPIC_API_KEY` is missing or `LLM_PROVIDER=mock`, use `MockLanguageModelV3` from `ai/test` (same major as the pinned `ai`) wired to a deterministic fake that returns plausible outputs for each pipeline step (a stubbed wiki page containing the new source titles with `[src:N]` citations, 3 stubbed tasks, a streamed stub chat answer). The mock must make all 5 flows run end to end so the app can be verified without network. Print a visible banner in the UI when running in mock mode.
- **Storage: files, no database.** `data/sources/<id>.json` (metadata + raw text), `data/wiki/**/*.md` (compiled pages, gray-matter frontmatter), `data/chats/<id>.json`, `data/tasks.json`, `data/compile-log.json`. `data/` is gitignored except `data/.gitkeep`. Rationale: the Markdown wiki *is* the product; other agents read it directly.
- **Libraries (all verified on npm/GitHub):** `ai` + `@ai-sdk/anthropic` + `@ai-sdk/react` (github.com/vercel/ai), `next` (github.com/vercel/next.js), `zod` v4 (github.com/colinhacks/zod), `gray-matter` (github.com/jonschlinkert/gray-matter), `react-markdown` (github.com/remarkjs/react-markdown), `commander` (github.com/tj/commander.js), `tsx` (github.com/privatenumber/tsx) for the CLI, `tailwindcss`.

## 4. Data model (TypeScript types in `src/lib/types.ts`)

```ts
type Source = { id: number; title: string; kind: "markdown"|"text"|"email"|"meeting"|"slack"|"csv"; createdAt: string; text: string; compiledAt?: string };
type WikiPage = { path: string /* e.g. "projects/atlas.md" */; title: string; kind: "overview"|"person"|"project"|"decisions"|"open-loops"|"timeline"|"glossary"; updated: string; sources: number[]; human_edited?: boolean; body: string };
type Task = { id: string; title: string; why: string; draft: string; sourceIds: number[]; status: "open"|"done"|"dismissed"; createdAt: string };
type CompileRun = { id: string; startedAt: string; finishedAt: string; sourceIds: number[]; pagesChanged: string[]; provider: "anthropic"|"mock"; usage?: { inputTokens: number; outputTokens: number } };
type Chat = { id: string; title: string; createdAt: string; messages: UIMessage[] };
```

## 5. Screens & endpoints

Screens (App Router): `/` Home (stats + suggested tasks), `/sources` (list, upload form, paste form, "Load sample company", delete), `/wiki` and `/wiki/[...slug]` (tree + rendered page + edit mode + source drawer), `/chat` and `/chat/[id]` (streaming chat with history list).

API routes (all JSON unless noted):
- `GET/POST/DELETE /api/sources` (POST accepts `{title, kind, text}` or multipart file upload; `POST /api/sources/sample` loads samples)
- `POST /api/compile` → runs compile pipeline, then runs suggestions; returns `CompileRun`
- `GET /api/wiki` (tree), `GET /api/wiki/[...slug]` (page), `PUT /api/wiki/[...slug]` (save human edit)
- `POST /api/chat` (AI SDK streaming; body `{chatId?, messages}`), `GET /api/chats`, `GET /api/chats/[id]`
- `GET /api/tasks`, `POST /api/suggest`, `PATCH /api/tasks/[id]` (`{status}`)
- `GET /api/status` → `{provider, lastCompiledAt, sourceCount, pageCount, uncompiledCount}`

## 6. LLM pipeline design (`src/lib/brain/`)

**compile(newSources, existingPages)**
1. *Extract* — for each new source, one `generateText` call with a strict JSON schema returning `{ summary, people: [{name, role?, facts[]}], projects: [{name, status?, facts[]}], decisions: [{what, when?, who?}], openLoops: [{what, owner?, due?}], events: [{date, what}], terms: [{term, meaning}] }`. Every fact string must end with `[src:<id>]`. Validate with zod; on parse failure retry once with the error message appended.
2. *Merge* — group extractions by target page (person → `people/<slug>.md`, project → `projects/<slug>.md`, rest → the fixed pages). For each affected page, one `generateText` call: input = current page Markdown (or an empty template), the new facts for that page, and the rule set (keep citations, keep `human_edited` paragraphs unless contradicted — then keep the human text and add a line under "Conflicts" in `open-loops.md`, dedupe, keep it under ~600 words, use H2 sections). Output = full new page Markdown. Write with updated frontmatter.
3. *Rebuild* `overview.md` last from all page titles + summaries (one call), and append to `timeline.md`'s table deterministically in code (no LLM).
4. Mark sources `compiledAt`, append `CompileRun`, then call **suggest()**.

**suggest(openLoopsPage, recentSources)** — one call → JSON `tasks: [{title, why, draft, sourceIds}]` (3–6). Skip tasks whose title already exists in `tasks.json` as open/done.

**chat(messages)** — build system prompt: persona ("You are the company brain for <company name from overview>"), rules (answer from wiki only, cite `[src:N]`, be concise), then `overview.md` + top-4 pages by lexical score against the latest user message (score = sum over query terms of tf in page × idf over pages; ignore stopwords) + the list of all page titles. Stream with `streamText`.

All prompts live in `src/lib/brain/prompts.ts` so they're easy to read and tweak.

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # required for real LLM calls; leave empty to run in mock mode
ANTHROPIC_MODEL=claude-sonnet-5-5
LLM_PROVIDER=                 # "anthropic" (default when key present) or "mock"
DATA_DIR=./data               # where sources/wiki/chats live
```

## 8. Explicitly skipped (not the product core, or needs paid accounts)

Auth/multi-user permissions, billing, OAuth integrations (Gmail/Calendar/Granola/GitHub/Slack live sync — replaced by file/paste/JSON-export ingest), the agent's own computer/browser (Browserbase), sending email or taking actions on external systems (we only produce drafts), iMessage, Mac desktop app, scheduled daily recompile (we expose a `compile` CLI command you can cron), vector search (lexical retrieval is enough at this scale), PDF/DOCX parsing (text/MD/JSON/CSV only).

## 9. Acceptance checks (the build must pass all; run in mock mode if no API key)

1. `npm install` and `npm run build` complete with no errors (TypeScript strict).
2. `npm run dev` (or `npm start` after build) boots; `GET /api/status` returns JSON with `provider: "mock"` when no key is set.
3. `POST /api/sources/sample` loads ≥8 sample sources; `GET /api/sources` lists them.
4. `POST /api/compile` completes and creates `data/wiki/overview.md`, at least 2 `people/*.md`, at least 2 `projects/*.md`, `decisions.md`, `open-loops.md`, `timeline.md`, `glossary.md`, each with valid frontmatter and at least one `[src:N]` citation; `data/compile-log.json` has one run.
5. `GET /api/wiki` returns the tree; `PUT /api/wiki/overview.md` with edited body persists and sets `human_edited: true`; a second `POST /api/compile` (after adding one more source) does not erase the human-edited paragraph.
6. `POST /api/chat` streams a response (verify with curl that chunks arrive) that contains at least one `[src:N]` citation in mock mode.
7. `GET /api/tasks` returns ≥3 suggested tasks after compile; `PATCH` to `done` persists.
8. CLI: `npm run brain -- wiki ls` lists pages; `npm run brain -- ask "what is the company working on"` prints an answer.
9. The four screens render without console errors (check with `curl` for 200 on `/`, `/sources`, `/wiki`, `/chat` and, if Playwright is available, a screenshot of `/wiki`).
10. `.gitignore` excludes `node_modules`, `.next`, `.env`, `data/*` (but keeps `data/.gitkeep`); `.env.example` present; no secrets in the repo.
