# Pomerado clone ("Minter")

An **independent learning clone** of [Pomerado](https://www.pomerado.ai) (YC F26; [Launch HN](https://news.ycombinator.com/item?id=50455811)). It is **not affiliated with Pomerado** and was **written from scratch from the public product description, without using or copying any Pomerado source code.**

## What the original company does

Pomerado turns any website into an MCP tool for AI agents. You describe a task on a site that has no API ("search the parts catalog and return name, price, stock"). A coding agent drives a real browser, completes the task once, and that run is generalised into a deterministic, parameterised integration (input schema, fixed browser steps, structured output). The integration is exposed as an MCP tool, and later calls replay the steps with no model in the loop (fast, cheap, repeatable). Sign-in is a deterministic step so the model never sees credentials, and when a site changes, a self-healing step repairs the integration.

## What this clone does

A local Node/TypeScript tool that implements that loop end to end:

- **Mint**: explore a site once, generalise the run into `integrations/<name>/integration.json`, verify it by running it once.
- **Run**: replay the integration with Playwright, no LLM.
- **MCP server**: stdio and Streamable HTTP. One tool per integration plus `build_website_tool`, `list_website_tools`, `run_website_tool`.
- **Two-level self-healing**: re-locate elements from stored semantic hints; if that fails, re-mint from the stored task.
- **Auth without exposing credentials**: secrets are read from env vars; the integration file stores only secret names.
- **Dashboard** (server-rendered HTML) and a bundled **demo site** ("Acme Industrial Parts Portal") so everything runs offline.

### What it skips
Hosted cloud, accounts/billing, residential proxies, CAPTCHA solving, 2FA/TOTP vault, phone numbers, PII redaction, the "Guardian" review model, synthetic-input overfit tests, HTTP-request-replay integrations (browser-only here), a React dashboard, and a persistent database (a JSONL run log and JSON files are used).

## Architecture

```
mint ──► explore ──► Recording ──► generalise ──► integration.json ──► verify run ──► saved
         (mock heuristic | real LLM tool loop)   (rule based | LLM Output.object)

run  ──► load + validate ─► fail fast on missing inputs/secrets ─► [auth steps] ─► steps ─► extract ─► run log
                                       │ TargetNotFound
                                       ├─ level 1: heal.ts re-locates by hints (role+name, label, placeholder, text, tag), patches selector, version++, continues
                                       └─ level 2: mint() again from stored url/task/exampleInput, retry once with heal off
```

- **Mint pipeline** (`src/mint/`): explorer produces a `Recording` (every action with a CSS selector *and* semantic hints). Mock mode is a heuristic explorer (fill first text input, select matching options, press the nearest submit button, extract first table, else first repeated list, else text). Real mode runs an AI SDK `generateText` tool loop (`navigate`, `snapshot`, `click`, `fill`, `fill_secret`, `select`, `press`, `extract_table`, `extract_list`, `finish`; `stepCountIs(25)`). Generalisation replaces literal example values with `{{input.key}}`, derives the input schema and adds `waitFor` steps.
- **Deterministic runner** (`src/runner.ts`): interprets the step list (`goto`, `fill`, `click`, `press`, `select`, `waitFor`, `waitForUrl`, `extract` table/list/text). Logs `{at,name,version,ok,ms,healed,error?,inputKeys,resultCount}` to `data/runs.jsonl`; never input values or secrets.
- **Two-level healing**: level 1 (`src/heal.ts`) rebuilds a unique CSS selector and persists it (`history: heal:selectors`); level 2 re-mints (`heal:remint`). The run result's `meta.healed` is `"selectors" | "remint" | null`.
- **MCP server** (`src/mcp/`): `McpServer` from the official SDK, zod v4 input schemas, `structuredContent` results, `sendToolListChanged()` after `build_website_tool`. `write` authority tools require `confirm: true`.
- **Demo site** (`src/demo-site/server.ts`): catalog search, login + orders, part detail. `DEMO_SITE_VERSION=2` renames ids/classes/field names but keeps labels, to exercise healing.

## GitHub tools used

| Need | Library | Link |
|---|---|---|
| Browser automation (pinned 1.63.0) | playwright | https://github.com/microsoft/playwright |
| MCP server/client | @modelcontextprotocol/sdk | https://github.com/modelcontextprotocol/typescript-sdk |
| LLM tool loop + structured output | ai (Vercel AI SDK) + @ai-sdk/anthropic | https://github.com/vercel/ai |
| Schemas | zod v4 | https://github.com/colinhacks/zod |
| HTTP | express | https://github.com/expressjs/express |
| CLI | commander | https://github.com/tj/commander.js |
| TS runner | tsx | https://github.com/privatenumber/tsx |
| Tests | vitest | https://github.com/vitest-dev/vitest |

## Setup and run

Requirements: Node 22, npm 10, Chromium matching Playwright 1.63.0 (pre-installed in this sandbox at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). **Do not run `playwright install`.** If `chromium.launch()` cannot find a browser, the code retries with `MINTER_CHROMIUM_PATH` (default `/opt/pw-browsers/chromium`).

```bash
npm install
cp .env.example .env            # optional; all defaults work in mock mode
npm run build                   # tsc -> dist/
npm test                        # vitest (unit + e2e against the demo site)

npm run demo-site               # terminal 1: demo site on :4310 (DEMO_SITE_VERSION=2 for the changed site)

# terminal 2
export MINTER_SECRET_LIST_ORDERS_USERNAME=demo MINTER_SECRET_LIST_ORDERS_PASSWORD=demo-pass
npm run mint -- --name search_parts --url http://localhost:4310/catalog \
  --task "Search the parts catalog and return the matching parts with name, price and stock" --input '{"query":"bolt"}'
npm run mint -- --name list_orders --url http://localhost:4310/orders \
  --task "List my recent orders with order number, date, status and total" \
  --auth-url http://localhost:4310/login --secret USERNAME --secret PASSWORD
npm run run -- search_parts '{"query":"washer"}'
npm run list
npm run heal -- search_parts    # force a level-2 re-mint
npm run serve                   # dashboard http://localhost:4311/ , MCP http://localhost:4311/mcp
npm run smoke                   # full end-to-end check (starts/stops its own demo site and servers)
```

`npm run smoke` needs ports 4310 and 4311 free. It regenerates the two sample integrations in `integrations/` (committed on purpose; `data/` is git-ignored).

### Use it from an agent (MCP)

Use absolute paths. Stdio (Claude Code):

```bash
claude mcp add minter -- npm run -s --prefix /abs/path/to/2026-11-12-pomerado mcp
# Streamable HTTP (after `npm run serve`):
claude mcp add --transport http minter http://localhost:4311/mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.minter]
command = "npm"
args = ["run", "-s", "--prefix", "/abs/path/to/2026-11-12-pomerado", "mcp"]
# HTTP alternative, if your Codex version supports it:
# url = "http://localhost:4311/mcp"
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{ "mcpServers": {
    "minter": { "command": "npm", "args": ["run", "-s", "--prefix", "/abs/path/to/2026-11-12-pomerado", "mcp"] },
    "minter-http": { "url": "http://localhost:4311/mcp" }
} }
```

In stdio mode, nothing but MCP traffic is written to stdout (logs go to stderr). Secrets must be present in the environment of the MCP server process (add an `env` block in the client config).

## Environment variables

See `.env.example`. `ANTHROPIC_API_KEY` (empty = mock mode), `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `MINTER_MOCK=1` (force mock), `MINTER_PORT` (4311), `MINTER_INTEGRATIONS_DIR`, `MINTER_DATA_DIR`, `MINTER_CHROMIUM_PATH`, `DEMO_SITE_PORT` (4310), `DEMO_SITE_VERSION` (1|2), `DEMO_USER`/`DEMO_PASS`, and `MINTER_SECRET_<INTEGRATION_NAME>_<SECRET>` (e.g. `MINTER_SECRET_LIST_ORDERS_PASSWORD`). Never commit a real `.env`.

## Mock vs real mode

- **Mock** (default without a key, or `MINTER_MOCK=1`): no model is called. A heuristic explorer and a rule-based generaliser mint the integration; this is what was tested here and is enough for simple search-then-table/list flows on the demo site.
- **Real** (`ANTHROPIC_API_KEY` set): the explorer and generaliser use the Anthropic model through the AI SDK, plus one retry of the generalise step if the verify run fails. **The real-mode code compiles but could not be run in this environment (no API key), so it is untested.**

Runs never use a model in either mode.

## Known limitations

- Real mode (LLM explorer/generaliser) is untested end to end; model id `claude-opus-5-5` and AI SDK v7 `Output.object` usage follow the spec.
- The mock explorer only handles a single search box + optional selects + submit, and tables/simple lists. No pagination, multi-page flows, dropdown widgets, iframes, or file downloads.
- Level-1 healing needs a unique match for the hints; ambiguous pages fall through to level 2, which in mock mode re-runs the same heuristic.
- Each run launches a fresh Chromium (about 0.3 s on the demo site); healing waits about 3 s per missing target.
- All inputs are strings. `write` authority is a confirm flag only; no review of the actions.
- Stateless HTTP MCP: a new server per request, no sessions or SSE push (`tools/list_changed` works on stdio).
- Secret values could appear on a site's page in an error message; runner output redacts known secret values from error text only.

## Next 3 things to build

1. Pagination and multi-page extraction (a `repeat`/`nextPage` step) plus typed output schemas.
2. A review step for real-mode mints (replay on a second example input to catch overfit, like Pomerado's synthetic-input tests) and a diff view of healed versions.
3. A session/cookie vault with TOTP support and per-run credential isolation, plus an HTTP-replay mode for sites with clean JSON endpoints.
