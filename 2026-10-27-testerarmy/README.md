# TesterArmy clone

A working clone of the web-testing half of **TesterArmy** (YC P26) — https://tester.army
Launch HN: https://news.ycombinator.com/item?id=48586299 ("Agents that test web and mobile apps").

> Built by an AI agent (Claude) from a written spec, in a single session. The **Anthropic planner path compiles and is selected when `ANTHROPIC_API_KEY` is set, but it was NOT exercised live** (no key in the build environment). Everything verified end to end used the deterministic mock planner.

## What the original does

TesterArmy lets a team describe end-to-end tests in plain language; an AI agent drives a real browser (web and mobile) like a manual QA tester, instead of brittle selector scripts. Each run yields a step log with screenshots and video plus a pass/fail verdict, and tests can be triggered from the UI, a schedule, CI, or a PR (including plans generated from diffs).

## What this clone does

- Create tests (name, start URL, one-step-per-line natural language, expected outcome); dashboard with last verdict / run count.
- Run a test: headless Chromium via Playwright, observe -> decide -> act loop per step (URL, title, ARIA snapshot truncated to 6000 chars), screenshot after every action, video of the whole run, final verdict. Limits: 12 actions/step, 25s/action, 4 min/run.
- Run report page (`/runs/[id]`): verdict, timeline, click-to-enlarge screenshots, final screenshot, `<video>`; polls every 2s while running.
- HTTP API for CI and `scripts/run-test.mjs <testId> [--wait]` (exit 0 pass, 1 fail/error).
- Built-in demo target app at `/demo` (login `demo` / `demo123`, todo list, deliberate "1 items left" bug when the last item is completed) and three seeded tests against it.
- Two planners: `AnthropicPlanner` (Vercel AI SDK `generateObject` + zod, when `ANTHROPIC_API_KEY` is set) and a rule-based `MockPlanner` (otherwise, or `PLANNER=mock`).

## What it skips

Auth/users/orgs, billing, mobile (iOS/Android), captcha solving, email/OTP inboxes, Slack/Discord alerts, cron scheduling, GitHub App / PR-diff test generation, trajectory caching, parallel runs (one run at a time, in-process queue), cloud sandboxes.

## Architecture

```
app/                    Next.js 15 App Router (UI + API routes)
  page.tsx              dashboard          tests/new, tests/[id]   create / detail
  runs/[id]/page.tsx    run report (client, polling)    demo/page.tsx  target app
  api/tests, api/runs, api/artifacts/[...path]
lib/db.ts               lowdb JSON store at DATA_DIR/db.json, seeds 3 tests on first boot
lib/agent/actions.ts    zod action schema + Observation type
lib/agent/executor.ts   action -> Playwright (locator resolution order, timeouts)
lib/agent/runner.ts     run loop, video/screenshots, verdict, in-memory queue
lib/agent/parse.ts      NL step -> Action regex parser (mock planner)
lib/agent/{mock,anthropic}-planner.ts, index.ts (planner selection)
scripts/run-test.mjs    CI/CLI trigger        tests/  vitest unit tests
```

Artifacts live in `data/runs/<runId>/` (`step-<i>-action-<j>.png`, `final.png`, `video.webm`) and are served by `/api/artifacts/...` (rejects `..`, only png/webm/jpg).

## GitHub tools used

vercel/next.js, microsoft/playwright (1.63.0, pinned), vercel/ai + @ai-sdk/anthropic, colinhacks/zod, typicode/lowdb, tailwindlabs/tailwindcss (v4), vitest-dev/vitest.

## Setup and run

Requires Node 22 and Playwright 1.63.0 Chromium browsers already installed (e.g. `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Do not need `playwright install` if those exist; otherwise run it yourself.

```bash
npm install
cp .env.example .env      # optional; add ANTHROPIC_API_KEY for the LLM planner
npm run build && npm start    # or: npm run dev   (port 3000; the seeded tests target localhost:3000/demo)
npm test                  # vitest
node scripts/run-test.mjs seed1 --wait    # exit 0
node scripts/run-test.mjs seed3 --wait    # exit 1 (the demo bug is caught)
```

Acceptance script: `npm run acceptance` (with the server running) automates SPEC §10 checks 2-5 against `BASE_URL` (default `http://localhost:3000`) and `DATA_DIR`.

The server must run on port 3000 for the seeded tests (their start URL is `http://localhost:3000/demo`; override with `DEMO_URL` before first boot, or edit/create tests in the UI).

## Environment variables

| Var | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | optional; enables the LLM planner |
| `ANTHROPIC_MODEL` | default `claude-sonnet-4-5` |
| `PLANNER` | `anthropic` or `mock`; auto-detect by default |
| `DATA_DIR` | default `./data` (db.json, screenshots, videos; gitignored) |
| `HEADLESS` | default `true` |
| `BASE_URL` | used only by `scripts/run-test.mjs` (default `http://localhost:3000`) |

## Verification performed

`npm install`, `npm run build` (no type errors), `npm test` (13 tests), `npm start` + the three seed runs through `scripts/run-test.mjs --wait` (seed1 passed/exit 0, seed2 passed, seed3 failed/exit 1 with reason mentioning "0 items left"); every action had a screenshot on disk and each run had `video.webm`; `/runs/<id>` rendered via Playwright with 6 steps, images and a `<video>`. Anthropic planner: selection logic unit-tested only.

## Known limitations

- Anthropic path never run against the real API; prompt quality and model behaviour are untested.
- Mock planner is regex-based: one action per step, unparseable steps fail.
- With the mock planner, the first failed action fails the step immediately (no retries); the LLM path retries until 12 actions.
- Runs are in-process: a server restart mid-run leaves a run stuck in `running`. Single run at a time.
- Small race at the end of a run: the status flips to `passed`/`failed` a few milliseconds before `videoPath`/`finishedAt` are written, so poll for `finishedAt` (as `scripts/acceptance.mjs` does) if you need the video immediately.
- Seed assertions use substring matching on page text ("0 items left" would also match "10 items left").
- No auth on the API; artifacts route is unauthenticated.

## Next 3 things to build

1. Exercise and tune the Anthropic planner live (screenshots as vision input, retry/backoff, token/cost accounting).
2. Scheduling and CI integration: cron runs, a ready-made GitHub Action using `scripts/run-test.mjs`, and Slack alerts.
3. Persistent job queue with parallel runs and recovery of orphaned runs, plus trajectory caching to replay passing tests cheaply.
