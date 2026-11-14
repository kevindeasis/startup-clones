// End-to-end check against a running server (default http://localhost:3000). Needs the demo seed.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const step = (msg) => console.log(`ok - ${msg}`);
const json = async (path) => (await fetch(BASE + path)).json();

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  // 1. Demo page generates live events
  await page.goto(`${BASE}/demo-page`);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Go to /pricing" }).click();
  await page.getByRole("button", { name: "Throw a JS error" }).click();
  await page.waitForTimeout(1500);
  const live = await json("/api/sites/demo/realtime");
  assert(live.events.some((e) => e.type === "event" && e.name === "signup"), "signup event missing");
  assert(live.events.some((e) => e.type === "pageview" && e.path === "/pricing"), "/pricing pageview missing");
  assert(live.events.some((e) => e.type === "error"), "error event missing");
  step(`demo page produced signup, /pricing pageview and error (realtime visitors=${live.visitors})`);

  // 2. Dashboard renders without console errors
  consoleErrors.length = 0;
  await page.goto(`${BASE}/sites/demo`);
  await page.waitForSelector("[data-testid=tile]");
  await page.waitForSelector(".recharts-surface");
  const tiles = await page.locator("[data-testid=tile]").count();
  const svgs = await page.locator("svg").count();
  assert(tiles >= 6, `expected >=6 tiles, got ${tiles}`);
  assert(svgs >= 1, "no svg rendered");
  assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
  step(`dashboard rendered ${tiles} tiles and ${svgs} svg elements with no console errors`);

  // 3. Funnels page
  await page.goto(`${BASE}/sites/demo/funnels`);
  await page.waitForSelector("[data-testid=funnel-step]");
  step(`funnels page shows ${await page.locator("[data-testid=funnel-step]").count()} funnel steps`);

  // 4. Ask Bunny
  await page.goto(`${BASE}/sites/demo/ask`);
  await page.getByLabel("Question").fill("What were my top 5 pages last week?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForSelector("[data-testid=sql-block]");
  const sql = await page.locator("[data-testid=sql-block] pre").first().innerText();
  assert(/^SELECT/i.test(sql.trim()), "SQL block does not start with SELECT");
  step(`Ask Bunny showed the SQL block: ${sql.split("\n")[0]}`);

  // 5. Insights page
  await page.goto(`${BASE}/sites/demo/insights`);
  await page.getByRole("button", { name: "Run check now" }).click();
  await page.waitForSelector("text=Suggested next steps");
  step("insights page ran a check and rendered the digest");
  console.log("E2E PASSED");
} finally {
  await browser.close();
}
