# SPEC — Pomerado clone ("Minter")

Date: 2026-11-12. Independent learning clone of **Pomerado** (YC F26, https://www.pomerado.ai, Launch HN 2026-11-11: https://news.ycombinator.com/item?id=50455811). Not affiliated. Pomerado has an MIT-licensed core on GitHub; **this clone is written from scratch from the public product description and must not copy or vendor any Pomerado source code.**

## 1. What the product does

Pomerado "turns any website into an MCP for your agents, in minutes". An agent (or a person) describes a task on a website that has no API ("search the parts catalog for a query and return name, price and stock"). A coding agent opens a real browser, explores the site, and completes the task once. That single run is then **generalised into a deterministic, parameterised integration** (input schema → fixed browser steps → structured output). The integration is exposed as an **MCP tool**; every later call replays the deterministic steps with no model in the loop (fast, cheap, same result every time). Sign-in is handled by a deterministic auth step so the model never sees credentials. When a site changes and a run fails, a **self-healing** step repairs the integration and completes the call.

The clone implements that loop end to end as a local Node/TypeScript tool: a **mint pipeline** (explore → generalise), a **deterministic runner** (Playwright), an **MCP server** (stdio and Streamable HTTP) that exposes each minted integration as a tool plus a `build_website_tool` tool, **two-level self-healing** (semantic re-location, then re-mint), and a tiny **dashboard**. A bundled **demo website** makes the whole thing runnable and testable offline.

## 2. Core user flows to implement

1. **Mint an integration** from a one-line task + example input: `npm run mint -- --name search_parts --url http://localhost:4310/catalog --task "Search the parts catalog and return the matching parts with name, price and stock" --input '{"query":"bolt"}'`. Result: `integrations/search_parts/integration.json` (see §5) and a printed sample output from the first run.
2. **Run an integration deterministically** (no LLM): `npm run run -- search_parts '{"query":"washer"}'` prints structured JSON rows.
3. **Use it from an agent over MCP**: `npm run mcp` (stdio) and `npm run serve` (Streamable HTTP at `http://localhost:4311/mcp`). `tools/list` returns one tool per integration plus `build_website_tool`, `list_website_tools`, `run_website_tool`. Calling `build_website_tool` mints a new integration at runtime and the server emits `tools/list_changed`.
4. **Self-heal when the site changes**: with the demo site switched to version 2 (ids/classes renamed, same labels), a run of `search_parts` must still succeed: level-1 healing re-locates elements from stored semantic hints and patches the stored selectors; if that fails, level-2 healing re-mints the integration from the stored task/example and retries once. Run log records `healed: "selectors" | "remint" | null`.
5. **Sign-in without exposing credentials**: `list_orders` integration on the demo portal logs in with secrets read from environment variables (`MINTER_SECRET_LIST_ORDERS_USERNAME` / `..._PASSWORD`), then extracts the orders table. The integration file stores only the secret *names*, never values.
6. **Dashboard** at `http://localhost:4311/`: list of integrations (name, url, task, created, call counts 24h/30d, last status), the last 20 runs, and a form to run an integration by name with a JSON input. Plain server-rendered HTML + a few lines of JS; no framework.

## 3. Stack and libraries (verified to exist, all open source)

| Need | Library | Notes |
|---|---|---|
| Runtime | Node 22, TypeScript 5, ESM (`"type": "module"`), run via `tsx` | Build with `tsc` to `dist/` for `npm run build`. |
| Browser automation | `playwright` **pinned to `1.63.0`** | The sandbox has Chromium for exactly 1.63 at `$PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Never run `playwright install`. If `chromium.launch()` fails to find a browser, retry with `executablePath: process.env.MINTER_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'` (document this). |
| MCP server | `@modelcontextprotocol/sdk` (1.32.x) | `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`, `server.registerTool`, `server.sendToolListChanged()`. Zod v4 schemas. |
| MCP test client | same SDK (`Client`, `StdioClientTransport`) | Used in the integration test and the smoke script. |
| LLM | `ai` (Vercel AI SDK v7) + `@ai-sdk/anthropic` (v4) | `generateText` with `tools` + `stopWhen: stepCountIs(n)` for the explore agent; `generateText` with `Output.object({ schema })` for the generalise step. Model id from `ANTHROPIC_MODEL`, default `claude-opus-5-5`. |
| Schemas | `zod` v4 | integration file validation, MCP tool input schemas. |
| HTTP | `express` (already a dependency of the MCP SDK, add it explicitly) | demo site, dashboard, Streamable HTTP MCP endpoint. |
| CLI | `commander` | `mint`, `run`, `list`, `heal`, `mcp`, `serve`, `demo-site`. |
| Tests | `vitest` | unit tests for templating, selector building, healing; one end-to-end test against the demo site. |

Do not add LangChain, Browser Use, a database, or a frontend framework.

## 4. Repository layout

```
2026-11-12-pomerado/
  package.json  tsconfig.json  vitest.config.ts  .env.example  .gitignore  README.md
  src/
    cli.ts                 # commander entry
    config.ts              # env parsing (MINTER_MOCK, ANTHROPIC_*, ports, paths)
    integration.ts         # zod schema for integration.json + load/save/list
    template.ts            # {{input.x}} / {{secret.X}} rendering
    browser.ts             # launch chromium (headless), page helpers, snapshot(), selector builder
    runner.ts              # deterministic step interpreter + extraction + run log + healing orchestration
    heal.ts                # level-1 hint re-location
    mint/
      index.ts             # mint(): explore -> generalise -> verify -> save
      explore-llm.ts       # real-mode explore agent (AI SDK tools over the browser)
      explore-mock.ts      # mock-mode heuristic explorer (no model)
      generalise-llm.ts    # real-mode: recording -> integration JSON (Output.object)
      generalise-mock.ts   # mock-mode: recording -> integration JSON (rule based)
    mcp/
      server.ts            # buildMcpServer(): registers tools from integrations dir
      stdio.ts             # npm run mcp
      http.ts              # express app: /mcp (Streamable HTTP), / dashboard, /api/*
    demo-site/
      server.ts            # express static+dynamic demo site on :4310, DEMO_SITE_VERSION=1|2
      pages/*.html / inline templates
  integrations/            # minted integrations (committed: the two demo integrations are regenerated by tests; commit the two sample files)
  data/runs.jsonl          # run log (gitignored)
  scripts/smoke.mjs        # end-to-end smoke (used by npm run smoke)
  test/*.test.ts
```

## 5. Data model — `integration.json`

```jsonc
{
  "name": "search_parts",                       // ^[a-z][a-z0-9_]{2,40}$
  "version": 3,                                 // bumped on every heal/re-mint
  "description": "Search the Acme parts catalog…",  // used as the MCP tool description
  "url": "http://localhost:4310/catalog",       // start URL
  "task": "…original natural-language task…",
  "authority": "read",                          // "read" | "write"; write tools ask for `confirm: true`
  "exampleInput": { "query": "bolt" },
  "inputSchema": {                              // JSON-schema-ish, strings only
    "type": "object",
    "properties": { "query": { "type": "string", "description": "Search text" } },
    "required": ["query"]
  },
  "auth": null | {
    "url": "http://localhost:4310/login",
    "fields": [ { "target": <Target>, "value": "{{secret.USERNAME}}" }, { "target": <Target>, "value": "{{secret.PASSWORD}}" } ],
    "submit": <Target>,
    "successCheck": { "type": "urlNotContains", "value": "/login" } | { "type": "visible", "target": <Target> },
    "secretNames": ["USERNAME", "PASSWORD"]     // env: MINTER_SECRET_<NAME_UPPER>_<SECRET>
  },
  "steps": [                                    // deterministic step list
    { "type": "goto", "url": "{{url}}" },
    { "type": "fill", "target": <Target>, "value": "{{input.query}}" },
    { "type": "click", "target": <Target> },            // or { "type": "press", "target": <Target>, "key": "Enter" }
    { "type": "waitFor", "target": <Target> },          // or { "type": "waitForUrl", "contains": "/results" }
    { "type": "select", "target": <Target>, "value": "{{input.category}}" },
    { "type": "extract", "mode": "table", "target": <Target>, "as": "rows" },
    { "type": "extract", "mode": "list", "target": <Target>, "item": "css", "fields": { "name": { "selector": "css", "attr": "text" }, "href": { "selector": "a", "attr": "href" } }, "as": "items" },
    { "type": "extract", "mode": "text", "target": <Target>, "as": "message" }
  ],
  "output": { "shape": "rows", "columns": ["name","price","stock"] },   // informational; MCP returns { results: <value of 'as'>, meta }
  "createdAt": "ISO", "updatedAt": "ISO",
  "history": [ { "version": 1, "at": "ISO", "reason": "mint" }, { "version": 2, "at": "ISO", "reason": "heal:selectors" } ]
}
```

`Target` = `{ "selector": "css string", "hints": { "role"?: "textbox|button|link|combobox|table|…", "name"?: "accessible name/label", "placeholder"?: string, "text"?: string, "tag"?: string } }`. Every element reference stores both a CSS selector **and** hints; the runner uses the selector first and the hints to heal.

Templating (`template.ts`): `{{input.key}}`, `{{secret.KEY}}`, `{{url}}`; missing input → run error listing the missing keys; secrets resolved from `process.env['MINTER_SECRET_' + NAME.toUpperCase() + '_' + KEY]` and never logged.

Run log (`data/runs.jsonl`, one JSON per line): `{ at, name, version, ok, ms, healed, error?, inputKeys, resultCount }`. Never log input values or secrets.

## 6. Browser layer (`browser.ts`)

- `launch()` → headless Chromium, one `BrowserContext` per run, `page.setDefaultTimeout(8000)`.
- `snapshot(page)` → compact text listing of interactive + content elements for the LLM/mock explorer: `[e12] textbox "Search parts" placeholder="Part name" selector="#q"`, `[e13] button "Search"`, `[e20] table 4 cols × 12 rows headers=[Part, Price, Stock, …]`, links with text + href, headings. Cap at ~150 elements. Build a stable CSS selector per element: prefer `#id`, then `[name=…]`, then `tag.class:nth-of-type` path from the nearest ancestor with an id. Also compute hints (role via `getByRole`-compatible mapping, accessible name from `<label for>`, `aria-label`, placeholder, button/link text).
- `locate(page, target)` → tries `page.locator(target.selector)`; if `count() === 0` throws `TargetNotFound` so the runner can heal.
- `extractTable(locator)` → header cells → keys (slugified, lowercased, deduped), body rows → objects. `extractList(locator, item, fields)`, `extractText`.

## 7. Runner (`runner.ts`) and healing

`runIntegration(name, input, { heal = true })`:
1. Load + validate integration; render templates; fail fast on missing inputs/secrets.
2. If `auth`: goto auth url, fill fields, click submit, assert `successCheck`; credentials only ever flow from env → `page.fill`.
3. Execute steps in order. `extract` steps accumulate into `outputs[as]`. Return `{ ok: true, results, meta: { name, version, ms, healed, steps: n } }`.
4. On `TargetNotFound` at step *i* (and `heal` on): call `healTarget(page, target)` (level 1, `heal.ts`): try `getByRole(role, { name })`, `getByLabel(name)`, `getByPlaceholder(placeholder)`, `getByText(text, { exact: true })`, `tag` fallback; require exactly one match; rebuild its CSS selector; patch the integration file in place (version++, history `heal:selectors`), and continue the run from step *i*. If level 1 fails: level 2 — call `mint()` again with the stored `url/task/exampleInput` (overwriting the integration, history `heal:remint`) and re-run once with `heal: false`. If still failing, return `{ ok: false, error }` with the step index and a short page summary.
5. Append the run-log line in all cases.

`authority: "write"` tools require `confirm: true` in the MCP input, otherwise return an error explaining it (mirrors Pomerado's read/write authority; demo integrations are both `read`).

## 8. Mint pipeline (`mint/index.ts`)

`mint({ name, url, task, exampleInput, authority })`:
1. **Explore** → `Recording = { startUrl, actions: Array<{ type, target?, value?, url?, snapshotBefore: string }>, finalSnapshot, finalExtraction?: {…} }`.
   - **Real mode** (`ANTHROPIC_API_KEY` set and `MINTER_MOCK` not `1`): AI SDK `generateText` with tools `navigate(url)`, `snapshot()`, `click(ref)`, `fill(ref, text)`, `select(ref, value)`, `press(ref, key)`, `extract_table(ref)`, `extract_list(ref, itemSelector, fields)`, `finish(summary, outputKey)`, `stopWhen: stepCountIs(25)`. System prompt: you are completing ONE example of the task to record it; use exactly the example input values; prefer tables/lists for extraction; call `finish` when the data is visible. Refs come from the latest snapshot; the tool implementation resolves `ref → Target` and records the action. Hard stop at 25 steps.
   - **Mock mode** (default when no key; print a one-line notice): heuristic explorer, no model: goto url → snapshot → if `auth` was requested (CLI `--auth-url`), do the login first; find the first text input (textbox/search) and fill it with the first example input value; for any `<select>` whose option text matches another example input value, select it; submit via the nearest submit button or Enter; wait for network idle; extract the first `<table>` as `rows`, else the first repeated list (`ul/ol/[role=list]` or ≥3 siblings sharing a class) as `items`, else main text. Record every action with targets/hints like the real mode.
2. **Generalise** → `integration.json`.
   - **Real mode**: `generateText` + `Output.object({ schema: IntegrationSchema minus timestamps })` with the recording, task, example input, and the rule "every literal value that equals an example input value must become `{{input.<key>}}`; keep selectors and hints exactly as recorded; add one `waitFor` after each navigation-causing click; describe each input key".
   - **Mock mode**: rule based — replace recorded values equal to example input values with the matching template, derive `inputSchema` from the example input keys, `description` from the task, `waitFor` on the extraction target.
3. **Verify**: run the new integration once with `heal: false` using `exampleInput`; require ≥1 result (rows/items non-empty or text non-empty). If it fails in real mode, send the error back to the generalise step once (one retry). Save, print the result summary.

## 9. MCP server (`mcp/server.ts`)

- `buildMcpServer({ integrationsDir })` → `McpServer({ name: "minter", version })`. For each integration: `registerTool(name, { title, description, inputSchema: zod object built from inputSchema.properties (all `z.string()` with `.describe`), plus `confirm: z.boolean().optional()` for write tools }, handler → runIntegration)`. Handler returns `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result }`.
- Static tools: `build_website_tool({ name, url, task, exampleInput: record<string,string>, authority? })` → mint, register the new tool, `sendToolListChanged()`, return the integration summary + first result. `list_website_tools()` → names, descriptions, versions, call counts. `run_website_tool({ name, input })` → same as calling the tool directly (useful for clients that cache the tool list).
- `stdio.ts`: `StdioServerTransport`. Never `console.log` on stdout in stdio mode (use `console.error`).
- `http.ts`: express; `POST/GET/DELETE /mcp` via `StreamableHTTPServerTransport` (stateless is fine: new transport per request with `sessionIdGenerator: undefined`); `GET /` dashboard (server-rendered HTML, light/dark via `prefers-color-scheme`); `GET /api/integrations`, `GET /api/runs?limit=20`, `POST /api/run { name, input }`.

## 10. Demo site (`demo-site/server.ts`, port 4310, `DEMO_SITE_VERSION` env 1 or 2, default 1)

"Acme Industrial Parts Portal", server-rendered by express (no JS needed for the flows):
- `GET /` landing with nav links.
- `GET /catalog` search form: text input (label "Search parts", v1 `id="q" name="q"`, v2 `id="part-search" name="search"` with the same label), category `<select>` (All/Fasteners/Bearings/Seals), submit button "Search". `GET /catalog?q=…&category=…` renders a results `<table>` (v1 `id="results"`, v2 `class="parts-grid"` without id) with headers Part, SKU, Price, Stock, Category; ≥20 seeded parts with names containing bolt/washer/bearing/seal/nut; matching is case-insensitive substring; "No parts found" message row when empty.
- `GET /login` form (label "Username", label "Password", button "Sign in"); `POST /login` sets a cookie when username `demo` / password `demo-pass` (configurable via env `DEMO_USER`/`DEMO_PASS`), else re-renders with an error. `GET /orders` requires the cookie (else redirect to `/login`) and renders an orders `<table>` (Order, Date, Status, Total) with 6 rows. v2 renames the login field ids/names but keeps the labels.
- `GET /parts/:sku` detail page (name, price, stock, description) so the real-mode explorer has somewhere to click.

## 11. CLI (`src/cli.ts`, via `npm run <script>` → `tsx src/cli.ts <cmd>`)

`mint --name --url --task --input <json> [--authority read|write] [--auth-url <url> --secret USERNAME --secret PASSWORD]` · `run <name> <json>` · `list` · `heal <name>` (force level-2 re-mint) · `mcp` · `serve [--port 4311]` · `demo-site [--port 4310]`. `npm run smoke` runs `scripts/smoke.mjs`: starts the demo site, mints `search_parts` and `list_orders` (mock), runs both, starts an MCP stdio client against `npm run mcp` and calls `tools/list` + `search_parts`, restarts the demo site with version 2, runs `search_parts` again and asserts `healed === "selectors"`, prints PASS/FAIL per check and exits non-zero on failure.

## 12. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # optional; when empty the tool runs in mock (heuristic) mode
ANTHROPIC_MODEL=claude-opus-5-5
MINTER_MOCK=                  # set to 1 to force mock mode even with a key
MINTER_PORT=4311
MINTER_INTEGRATIONS_DIR=./integrations
MINTER_DATA_DIR=./data
MINTER_CHROMIUM_PATH=         # optional explicit Chromium binary
DEMO_SITE_PORT=4310
DEMO_SITE_VERSION=1
DEMO_USER=demo
DEMO_PASS=demo-pass
MINTER_SECRET_LIST_ORDERS_USERNAME=demo
MINTER_SECRET_LIST_ORDERS_PASSWORD=demo-pass
```

## 13. What to skip

Hosted cloud, accounts/billing, residential proxies, CAPTCHA solving, 2FA/TOTP vault, phone numbers, PII redaction, the "Guardian" review model, synthetic-input overfit tests, HTTP-request-replay integrations (browser-only here), a React dashboard, persistent DB. Say so in the README.

## 14. Acceptance checks (all must pass in mock mode, no API key)

1. `npm install` (Playwright 1.63.0 resolves the pre-installed Chromium; no `playwright install`), `npm run build` (tsc, zero errors), `npm test` (vitest, all green).
2. `npm run demo-site` serves `/catalog` on 4310; `curl 'http://localhost:4310/catalog?q=bolt'` contains a `<table>` with ≥1 bolt row.
3. Mint `search_parts` in mock mode writes `integrations/search_parts/integration.json` with: `inputSchema.properties.query`, a `fill` step whose value is `{{input.query}}`, a submit (`click` or `press`) step, an `extract` step with `mode: "table"`, and every target has both `selector` and `hints`. The verify run returns ≥1 row with keys including `part`, `price`, `stock`.
4. `npm run run -- search_parts '{"query":"washer"}'` prints rows whose `part` values all contain "washer" (case-insensitive) and the run-log line has `ok: true, healed: null`. `'{"query":"zzzz"}'` returns `ok: true` with 0 results (not an error).
5. Mint `list_orders` with `--auth-url http://localhost:4310/login --secret USERNAME --secret PASSWORD`; the integration file contains no `demo-pass` string; running it returns 6 orders; unsetting the password env var returns `ok: false` with a "missing secret" error.
6. MCP stdio: a client `tools/list` includes `search_parts`, `list_orders`, `build_website_tool`, `list_website_tools`, `run_website_tool`; `tools/call search_parts {query:"bearing"}` returns `structuredContent.results` with ≥1 row. `build_website_tool` for a new name (e.g. `find_seals`) creates a file and the tool appears in a subsequent `tools/list`.
7. Self-heal: with the demo site on `DEMO_SITE_VERSION=2`, `npm run run -- search_parts '{"query":"bolt"}'` succeeds, the integration `version` increments, `history` gains `heal:selectors`, and the stored selector for the search box is no longer `#q`.
8. `npm run serve`: `GET /` returns HTML listing both integrations; `POST /mcp` with an `initialize` JSON-RPC request returns a result; `POST /api/run {name:"search_parts", input:{query:"nut"}}` returns rows.
9. `npm run smoke` prints PASS for every check above that it covers and exits 0.
10. `git status` inside the folder shows no `node_modules`, `dist`, `data/`, or `.env`.
