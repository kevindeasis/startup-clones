import path from 'node:path';
import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { nanoid } from './id';
import { getDb, dataDir } from '../db';
import type { Run, RunStep, ActionRecord, Test } from '../types';
import type { Observation } from './actions';
import type { Planner } from './planner';
import { createPlanner } from './index';
import { executeAction, settle } from './executor';

const MAX_ACTIONS_PER_STEP = 12;
const ACTION_TIMEOUT_MS = 25_000;
const RUN_TIMEOUT_MS = 4 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

async function save(run: Run) {
  const db = await getDb();
  const i = db.data.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) db.data.runs[i] = run;
  else db.data.runs.push(run);
  await db.write();
}

export async function createRun(testId: string): Promise<Run> {
  const planner = createPlanner();
  const run: Run = { id: nanoid(), testId, status: 'queued', planner: planner.name, steps: [] };
  await save(run);
  return run;
}

async function observe(page: Page, test: Test, stepInstruction: string, prev: Observation['previousActionsInStep'], withText = false): Promise<Observation> {
  let aria = '';
  try {
    aria = await page.locator('body').ariaSnapshot({ timeout: 5000 });
  } catch (e) {
    aria = `(could not capture snapshot: ${(e as Error).message})`;
  }
  let pageText: string | undefined;
  if (withText) pageText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    ariaSnapshot: aria.slice(0, 6000),
    stepInstruction,
    previousActionsInStep: prev,
    allSteps: test.steps,
    expectedOutcome: test.expectedOutcome,
    pageText,
  };
}

export async function executeRun(runId: string): Promise<void> {
  const db = await getDb();
  const run = db.data.runs.find((r) => r.id === runId)!;
  const test = db.data.tests.find((t) => t.id === run.testId);
  const started = Date.now();
  run.status = 'running';
  run.startedAt = new Date().toISOString();
  await save(run);

  const runDir = path.join(dataDir(), 'runs', run.id);
  fs.mkdirSync(runDir, { recursive: true });
  const rel = (p: string) => path.relative(dataDir(), p).split(path.sep).join('/');

  let browser: Browser | undefined;
  let context: Awaited<ReturnType<Browser['newContext']>> | undefined;
  let page: Page | undefined;
  try {
    if (!test) throw new Error('test not found');
    const planner: Planner = createPlanner();
    run.planner = planner.name;
    browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' ? true : false });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: runDir, size: { width: 1280, height: 800 } } });
    page = await context.newPage();
    const deadline = started + RUN_TIMEOUT_MS;
    const checkDeadline = () => {
      if (Date.now() > deadline) throw new Error('run exceeded 4 minute limit');
    };

    await page.goto(test.startUrl, { timeout: 30_000, waitUntil: 'domcontentloaded' });

    let failed = false;
    for (let i = 0; i < test.steps.length; i++) {
      const instruction = test.steps[i];
      const step: RunStep = { index: i, instruction, status: 'passed', actions: [], startedAt: new Date().toISOString() };
      run.steps.push(step);
      if (failed) {
        step.status = 'skipped';
        continue;
      }
      await save(run);

      let stepDone = false;
      for (let j = 0; j < MAX_ACTIONS_PER_STEP && !stepDone; j++) {
        checkDeadline();
        const prev = step.actions.map((a) => ({ action: a.action, ok: a.ok, error: a.error }));
        const obs = await observe(page, test, instruction, prev);
        const { action, reasoning } = await planner.decide(obs);
        const t0 = Date.now();

        if (action.type === 'done') {
          stepDone = true;
          if (step.actions.length === 0) {
            step.actions.push({ action, reasoning, ok: true, tookMs: 0, urlAfter: page.url() });
          }
          break;
        }

        const rec: ActionRecord = { action, reasoning, ok: true, tookMs: 0 };
        if (action.type === 'fail') {
          rec.ok = false;
          rec.error = action.reason ?? 'planner reported failure';
        } else {
          try {
            await withTimeout(executeAction(page, action), ACTION_TIMEOUT_MS, `action ${action.type}`);
          } catch (e) {
            rec.ok = false;
            rec.error = (e as Error).message.split('\n')[0];
          }
          await settle(page);
        }
        rec.tookMs = Date.now() - t0;
        rec.urlAfter = page.url();
        try {
          const file = path.join(runDir, `step-${i}-action-${j}.png`);
          await page.screenshot({ path: file, fullPage: true, timeout: 10_000 });
          rec.screenshotPath = rel(file);
        } catch {
          /* screenshot best-effort */
        }
        step.actions.push(rec);
        await save(run);

        if (action.type === 'fail' || !rec.ok) {
          // For LLM planner, allow it to retry after executor errors until the cap; mock planner fails fast.
          if (action.type === 'fail' || planner.name === 'mock') {
            step.status = 'failed';
            failed = true;
            break;
          }
          if (j === MAX_ACTIONS_PER_STEP - 1) {
            step.status = 'failed';
            failed = true;
          }
        }
      }
      if (!stepDone && step.status === 'passed' && !failed) {
        step.status = 'failed';
        failed = true;
        step.actions[step.actions.length - 1] && (step.actions[step.actions.length - 1].error ??= 'step exceeded max actions');
      }
      step.finishedAt = new Date().toISOString();
      await save(run);
    }

    const finalObs = await observe(page, test, '(final verdict)', [], true);
    if (failed) {
      const bad = run.steps.find((s) => s.status === 'failed')!;
      const err = bad.actions.find((a) => !a.ok)?.error;
      run.status = 'failed';
      run.verdictReason = `Step ${bad.index + 1} failed: ${err ?? 'unknown'}`;
    } else {
      const v = await planner.verdict(finalObs);
      run.status = v.pass ? 'passed' : 'failed';
      run.verdictReason = v.reason;
    }
    try {
      const file = path.join(runDir, 'final.png');
      await page.screenshot({ path: file, fullPage: true, timeout: 10_000 });
      run.finalScreenshotPath = rel(file);
    } catch {
      /* ignore */
    }
  } catch (e) {
    run.status = 'error';
    run.error = (e as Error).message;
  } finally {
    try {
      const video = page?.video();
      await context?.close();
      if (video) {
        const src = await video.path();
        const dest = path.join(runDir, 'video.webm');
        if (src !== dest && fs.existsSync(src)) fs.renameSync(src, dest);
        if (fs.existsSync(dest)) run.videoPath = rel(dest);
      }
    } catch {
      /* ignore */
    }
    await browser?.close().catch(() => {});
    run.finishedAt = new Date().toISOString();
    run.durationMs = Date.now() - started;
    await save(run);
  }
}

// tiny in-memory queue: one run at a time
const q = globalThis as unknown as { __queue?: Promise<void> };
export function enqueueRun(runId: string) {
  q.__queue = (q.__queue ?? Promise.resolve()).then(() => executeRun(runId)).catch(() => {});
}
