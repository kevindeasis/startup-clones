# Build spec — TesterArmy clone ("tester-army-clone")

Date: 2026-10-27. Original company: **TesterArmy (YC P26, Spring 2026)** — https://tester.army
Launch HN (June 2026): "Agents that test web and mobile apps" — https://news.ycombinator.com/item?id=48586299

## 1. What the product does

TesterArmy lets a team describe an end-to-end test in plain language ("log in with demo credentials, add a todo called 'Buy milk', verify it shows in the list"). An AI agent then drives a real browser the way a manual QA tester would — reading the page, clicking, typing, and verifying — instead of relying on brittle selector-based scripts. Each run produces a step-by-step log with screenshots and a video, and a pass/fail verdict. Tests can be triggered from the UI, on a schedule, from CI, or from a PR.

The clone implements the **web** half of that: natural-language tests, an LLM agent that executes them in headless Chromium via Playwright, a run timeline with screenshots + video, and an HTTP API so CI can trigger runs. Mobile testing, captchas, OTP inboxes, Slack/Discord alerts, scheduling, PR-plan generation from diffs, and SOC2-grade multi-tenancy are out of scope (see §9).

## 2. Core user flows to implement

1. **Create a test** — Form with: name, start URL, steps (free text, one step per line), expected outcome (free text). Saved to the store. Tests are listed on the home page with their last run status.
2. **Run a test (the agent)** — Click "Run" (or `POST /api/tests/:id/run`). The server launches headless Chromium (Playwright), opens the start URL, and for each step runs an observe→decide→act loop: snapshot the page (URL, title, ARIA snapshot of the body), ask the planner for the next action, execute it, take a screenshot, record the step. After all steps, the planner checks the expected outcome and returns `pass` or `fail` with a reason. The whole run is video-recorded. Hard limits: max 12 actions per step, 25s per action, 4 minutes per run.
3. **View a run** — Page showing verdict, duration, each step's instruction, each action taken (type + target + result), thumbnails of screenshots (click to enlarge), the final screenshot, the error message if any, and the video (`<video>` tag) when present.
4. **Run history + dashboard** — Home page lists tests (name, URL, last verdict, last run time, run count) and each test page lists its runs newest first. Runs can be re-triggered from either page.
5. **Trigger from CI / CLI** — `POST /api/tests/:id/run` returns `{ runId }` immediately and runs in the background; `GET /api/runs/:id` returns the run JSON (status `queued|running|passed|failed|error`). Include a tiny script `scripts/run-test.mjs <testId> [--wait]` that calls these endpoints and exits non-zero on failure, so a GitHub Action could use it.

## 3. Stack

- **Next.js 15 (App Router) + TypeScript** — UI and API routes. Pin `next@^15.5`. React 19. Use `serverExternalPackages: ['playwright']` in `next.config.ts`.
- **Playwright 1.63.0** (`playwright@1.63.0`, pinned exactly — the sandbox already has matching browsers in `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; do NOT run `playwright install`). Headless Chromium, `recordVideo`, screenshots, `locator.ariaSnapshot()`, role/text/label locators.
- **Vercel AI SDK v5** (`ai@^5`, `@ai-sdk/anthropic@^2`) + **zod** for the LLM planner (`generateObject` with a zod action schema).
- **lowdb** (`lowdb@^7`) — JSON-file persistence at `data/db.json` (tests, runs, steps). Screenshots and videos written under `data/runs/<runId>/` and served by an API route.
- **Tailwind CSS v4** for styling (keep the UI clean, minimal; no component library needed).
- Tests: **Vitest** for the mock planner and the parsing helpers (a handful of unit tests), plus the end-to-end acceptance check in §10 run with a script.

All of these are mature open-source GitHub projects: vercel/next.js, microsoft/playwright, vercel/ai, colinhacks/zod, typicode/lowdb, tailwindlabs/tailwindcss, vitest-dev/vitest.

## 4. Data model (lowdb JSON)

```ts
type Test = {
  id: string; name: string; startUrl: string;
  steps: string[];            // natural-language steps, in order
  expectedOutcome: string;    // natural-language assertion for the end state
  createdAt: string; updatedAt: string;
};
type Run = {
  id: string; testId: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'error';
  planner: 'anthropic' | 'mock';
  startedAt?: string; finishedAt?: string; durationMs?: number;
  verdictReason?: string;     // why it passed/failed
  error?: string;             // infra error (browser crashed, timeout...)
  videoPath?: string;         // relative to data/
  finalScreenshotPath?: string;
  steps: RunStep[];
};
type RunStep = {
  index: number; instruction: string;
  status: 'passed' | 'failed' | 'skipped';
  actions: ActionRecord[];
  startedAt: string; finishedAt?: string;
};
type ActionRecord = {
  action: Action;             // what the planner decided
  reasoning?: string;         // planner's one-line rationale
  ok: boolean; error?: string;
  screenshotPath?: string;    // relative to data/
  urlAfter?: string; tookMs: number;
};
```

## 5. The agent (planner + executor)

**Action schema (zod):**
```ts
{ type: 'goto', url }                       // navigate
{ type: 'click', target }                   // target = visible text / accessible name
{ type: 'fill', target, value }             // target = label, placeholder, or name of a textbox
{ type: 'press', key }                      // e.g. 'Enter'
{ type: 'select', target, value }
{ type: 'scroll', direction: 'up'|'down' }
{ type: 'wait', ms }                        // <= 5000
{ type: 'assert_text', text }               // text must be visible on the page
{ type: 'assert_url_contains', fragment }
{ type: 'done', summary }                   // step complete
{ type: 'fail', reason }                    // step cannot be completed
```

**Executor** (`lib/agent/executor.ts`): maps each action to Playwright. Resolution order for `click`: `getByRole('button'|'link', {name, exact:false})` → `getByText(target, {exact:false})` → `getByLabel` → `getByPlaceholder`; use `.first()`, 10s timeout. For `fill`: `getByLabel` → `getByPlaceholder` → `getByRole('textbox', {name})` → `locator('[name="..."]')`. Every action is followed by `page.waitForLoadState('domcontentloaded')` (best-effort, 3s) and a full-page screenshot saved as `data/runs/<runId>/step-<i>-action-<j>.png`.

**Observation** passed to the planner: `{ url, title, ariaSnapshot (truncated to 6000 chars), stepInstruction, previousActionsInStep, allSteps, expectedOutcome }`.

**Planner interface** (`lib/agent/planner.ts`): `decide(observation): Promise<{ action, reasoning }>` and `verdict(observation): Promise<{ pass: boolean, reason }>`.

- **AnthropicPlanner** — used when `ANTHROPIC_API_KEY` is set. `generateObject` with the action schema, model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`). System prompt: "You are a QA tester driving a browser. You are given the current step, the page's accessibility snapshot, and the actions already taken for this step. Return exactly ONE next action. Prefer accessible names exactly as they appear in the snapshot. Return `done` as soon as the step is satisfied; return `fail` if it cannot be satisfied after honest attempts." Verdict prompt: given the final snapshot and the expected outcome, return `{ pass, reason }`.
- **MockPlanner** — used when no key is set (and when `PLANNER=mock`). Deterministic, rule-based parsing of the step text so the browser actually gets driven and screenshots are real. Patterns (case-insensitive):
  - `go to|open|navigate to <url>` → goto
  - `click [on] [the] "<x>"|<x> [button|link]` → click
  - `type|enter|fill [in] "<value>" in[to] [the] "<field>"` (also `fill <field> with <value>`) → fill
  - `press <key>` → press
  - `select "<value>" in <field>` → select
  - `expect|verify|check|assert [that] "<text>" [is visible|appears|is shown]` or `... the page contains "<text>"` → assert_text
  - `url contains "<x>"` → assert_url_contains
  - `wait <n> seconds` → wait
  - anything else → `fail` with reason "mock planner cannot interpret this step; set ANTHROPIC_API_KEY for the LLM planner".
  After one successful action the mock planner returns `done` for that step. Its verdict: parse the expected outcome the same way — if it yields assert_text / assert_url_contains, evaluate them against the final page; otherwise pass if all steps passed.

**Run loop** (`lib/agent/runner.ts`): create run (status running) → launch chromium headless → new context with `recordVideo: { dir: data/runs/<runId>/ }`, viewport 1280×800 → goto startUrl → for each step: up to 12 planner calls, execute, record; a `fail` action or an executor error marks the step failed and stops the run (remaining steps `skipped`) → verdict → final screenshot → close context (this finalizes the video; rename it to `video.webm`) → save run. Catch everything; on infra error set status `error`. Runs execute in-process via a tiny in-memory queue (one run at a time) started by the API route — fine for a clone.

## 6. Screens & endpoints

Pages (App Router):
- `/` — dashboard: tests table + "New test" button + planner badge ("LLM: Anthropic" or "Mock planner — set ANTHROPIC_API_KEY").
- `/tests/new` — create form (name, start URL, steps textarea, expected outcome). Pre-fill a sample that targets the built-in demo app.
- `/tests/[id]` — test details, steps, "Run now" button, runs list.
- `/runs/[id]` — run report as in flow 3. Poll `GET /api/runs/:id` every 2s while queued/running.
- `/demo` — a **built-in demo target app** (pure client-side React, no backend): a login form (username `demo`, password `demo123`; wrong password shows "Invalid credentials") that reveals a todo list page where you can add items, check them off, and see a "N items left" counter. Must have proper `<label>`s and button text so both planners can drive it. Also `/demo` must include a deliberately buggy flow for the demo: marking the LAST remaining item complete shows "1 items left" instead of "0 items left" (so a test can catch a real bug).

API:
- `GET/POST /api/tests` · `GET/DELETE /api/tests/:id` · `POST /api/tests/:id/run` → `{ runId }`
- `GET /api/runs?testId=` · `GET /api/runs/:id`
- `GET /api/artifacts/[...path]` → serves files under `data/` (png/webm) with correct content types; reject `..`.

## 7. Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=            # optional; without it the deterministic mock planner is used
ANTHROPIC_MODEL=claude-sonnet-4-5
PLANNER=                      # 'anthropic' | 'mock' (auto-detect by default)
DATA_DIR=./data               # where db.json, screenshots and videos go
HEADLESS=true
```

## 8. Seed data

On first boot, if `db.json` has no tests, seed three tests against the demo app (`http://localhost:3000/demo`):
1. "Login and add a todo" — steps: `Type "demo" into the "Username" field` / `Type "demo123" into the "Password" field` / `Click the "Sign in" button` / `Type "Buy milk" into the "New todo" field` / `Click the "Add" button` / `Verify that "Buy milk" is visible`; expected: `The page contains "1 items left"`. → should PASS.
2. "Wrong password shows an error" — steps: `Type "demo" into the "Username" field` / `Type "wrong" into the "Password" field` / `Click the "Sign in" button`; expected: `The page contains "Invalid credentials"`. → should PASS.
3. "Completing the last todo shows zero left (known bug)" — steps: login as above, add "Buy milk", `Click the "Buy milk" checkbox`; expected: `The page contains "0 items left"` → should FAIL (the demo shows "1 items left"), demonstrating the agent catching a bug.

## 9. Skip

Auth/users/orgs, billing, mobile/iOS/Android, captcha solving, email/OTP inboxes, Slack/Discord alerts, cron scheduling, GitHub App / PR-diff test generation, trajectory caching, parallel runs, cloud sandboxes. Note each in the README's "what it skips".

## 10. Acceptance checks (must all pass; run them, don't assume)

1. `npm install` succeeds; `npm run build` succeeds with no type errors; `npm test` (vitest) passes.
2. `npm run dev` (or `npm start` after build) boots on port 3000; `GET /` returns 200 and shows the seeded tests; `GET /demo` returns 200.
3. With no `ANTHROPIC_API_KEY`: `POST /api/tests/<seed1>/run` → polling `GET /api/runs/<id>` ends in `passed`, with ≥6 steps each having ≥1 action, a screenshot per action that exists on disk, and `video.webm` present.
4. Seed test 2 ends `passed`; seed test 3 ends `failed` with a verdictReason mentioning "0 items left".
5. `node scripts/run-test.mjs <seed1> --wait` exits 0; for seed 3 it exits 1.
6. `/runs/<id>` renders the timeline with screenshots and the video element.
7. The `AnthropicPlanner` code path compiles and is selected when the key is present (cannot be exercised live here; say so in the README).
8. `.gitignore` excludes `node_modules`, `.next`, `data/`, `.env*` (but not `.env.example`).
