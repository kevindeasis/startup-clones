import type { Page } from 'playwright';
import {
  BrowserSession,
  TargetNotFound,
  extractList,
  extractTable,
  extractText,
  locate,
  pageSummary,
} from './browser.js';
import { healTarget } from './heal.js';
import { loadIntegration, recordVersion, type Integration, type Step, type Target } from './integration.js';
import { appendRun } from './runlog.js';
import { findMissing, render, secretEnvName, type RenderContext } from './template.js';

export type Healed = 'selectors' | 'remint' | null;

export interface RunMeta {
  name: string;
  version: number;
  ms: number;
  healed: Healed;
  steps: number;
}
export interface RunResult {
  ok: boolean;
  results?: unknown;
  error?: string;
  failedStep?: number;
  kind?: 'input' | 'secret' | 'run';
  meta: RunMeta;
}
export interface RunOptions {
  heal?: boolean;
  /** persist level-1 patches to disk (default true) */
  persist?: boolean;
  integrationsDir?: string;
  env?: NodeJS.ProcessEnv;
}

type InternalStep = Step | { type: 'authCheck'; check: NonNullable<Integration['auth']>['successCheck'] };

function normalizeInput(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input ?? {})) out[k] = v == null ? '' : String(v);
  return out;
}

function buildSteps(integ: Integration): InternalStep[] {
  const steps: InternalStep[] = [];
  if (integ.auth) {
    steps.push({ type: 'goto', url: integ.auth.url });
    for (const f of integ.auth.fields) steps.push({ type: 'fill', target: f.target, value: f.value });
    steps.push({ type: 'click', target: integ.auth.submit });
    steps.push({ type: 'authCheck', check: integ.auth.successCheck });
  }
  return [...steps, ...integ.steps];
}

function allTargets(integ: Integration): Target[] {
  const out: Target[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.selector === 'string' && o.hints && typeof o.hints === 'object') out.push(o as unknown as Target);
      else Object.values(o).forEach(walk);
    }
  };
  walk([integ.auth, integ.steps]);
  return out;
}

export function resultCount(results: unknown): number {
  if (Array.isArray(results)) return results.length;
  if (typeof results === 'string') return results.trim() ? 1 : 0;
  if (results && typeof results === 'object') return Object.values(results).reduce<number>((n, v) => n + resultCount(v), 0);
  return 0;
}

/** Run an already-loaded integration with no model in the loop. Does not write the run log. */
export async function executeIntegration(
  integ: Integration,
  rawInput: Record<string, unknown>,
  opts: RunOptions = {},
): Promise<RunResult> {
  const heal = opts.heal ?? true;
  const input = normalizeInput(rawInput);
  const env = opts.env ?? process.env;
  const started = Date.now();
  const meta: RunMeta = { name: integ.name, version: integ.version, ms: 0, healed: null, steps: 0 };
  const fail = (error: string, kind: RunResult['kind'], failedStep?: number): RunResult => {
    meta.ms = Date.now() - started;
    return { ok: false, error, kind, failedStep, meta };
  };

  // 1. fail fast on missing inputs / secrets (names only, never values)
  const missing = findMissing([integ.auth, integ.steps], { input, integrationName: integ.name, env });
  const required = integ.inputSchema.required ?? [];
  const missingInputs = [...new Set([...missing.missingInputs, ...required.filter((k) => !(k in input))])];
  if (missingInputs.length) return fail(`missing input: ${missingInputs.join(', ')}`, 'input');
  if (missing.missingSecrets.length) return fail(`missing secret: ${missing.missingSecrets.join(', ')}`, 'secret');

  const secretValues = (integ.auth?.secretNames ?? [])
    .map((s) => env[secretEnvName(integ.name, s)])
    .filter((v): v is string => !!v);
  const redact = (s: string) => secretValues.reduce((acc, v) => acc.split(v).join('***'), s);

  const ctx: RenderContext = { input, url: integ.url, integrationName: integ.name, env };
  const steps = buildSteps(integ);
  const outputs: Record<string, unknown> = {};
  const healedTargets = new WeakSet<Target>();
  let session: BrowserSession | null = null;
  let idx = 0;
  try {
    session = await BrowserSession.open();
    const page = session.page;
    for (; idx < steps.length; idx++) {
      try {
        await execStep(page, steps[idx], ctx, outputs);
      } catch (err) {
        if (err instanceof TargetNotFound && heal && !healedTargets.has(err.target)) {
          healedTargets.add(err.target);
          const sel = await healTarget(page, err.target);
          if (sel) {
            const old = err.target.selector;
            for (const t of allTargets(integ)) if (t.selector === old) t.selector = sel;
            err.target.selector = sel;
            meta.healed = 'selectors';
            if (opts.persist !== false) recordVersion(integ, 'heal:selectors', opts.integrationsDir);
            idx--; // retry this step with the patched selector
            continue;
          }
        }
        throw err;
      }
    }
    meta.steps = steps.length;
    meta.ms = Date.now() - started;
    meta.version = integ.version;
    const keys = Object.keys(outputs);
    const results = keys.length === 1 ? outputs[keys[0]] : outputs;
    return { ok: true, results, meta };
  } catch (err) {
    let msg = err instanceof Error ? err.message : String(err);
    if (err instanceof TargetNotFound) msg = `step ${idx}: ${msg}`;
    else msg = `step ${idx}: ${msg.split('\n')[0]}`;
    if (session) msg += ` | page: ${await pageSummary(session.page)}`;
    meta.version = integ.version;
    return fail(redact(msg), 'run', idx);
  } finally {
    await session?.close();
  }
}

async function execStep(
  page: Page,
  step: InternalStep,
  ctx: RenderContext,
  outputs: Record<string, unknown>,
): Promise<void> {
  const settle = () => page.waitForLoadState('load').catch(() => {});
  switch (step.type) {
    case 'goto':
      await page.goto(render(step.url, ctx));
      return;
    case 'fill': {
      const loc = await locate(page, step.target);
      await loc.fill(render(step.value, ctx));
      return;
    }
    case 'click': {
      const loc = await locate(page, step.target);
      await loc.click();
      await settle();
      return;
    }
    case 'press': {
      const loc = await locate(page, step.target);
      await loc.press(step.key);
      await settle();
      return;
    }
    case 'select': {
      const loc = await locate(page, step.target);
      const v = render(step.value, ctx);
      try {
        await loc.selectOption({ label: v }, { timeout: 2000 });
      } catch {
        await loc.selectOption({ value: v });
      }
      return;
    }
    case 'waitFor':
      await locate(page, step.target, 6000);
      return;
    case 'waitForUrl':
      await page.waitForURL((u) => u.href.includes(render(step.contains, ctx)));
      return;
    case 'authCheck':
      if (step.check.type === 'urlNotContains') {
        await settle();
        if (page.url().includes(step.check.value)) throw new Error('sign-in failed (still on login page)');
      } else await locate(page, step.check.target);
      return;
    case 'extract': {
      const loc = await locate(page, step.target, 6000);
      if (step.mode === 'table') outputs[step.as] = await extractTable(loc);
      else if (step.mode === 'list') outputs[step.as] = await extractList(loc, step.item, step.fields);
      else outputs[step.as] = await extractText(loc);
      return;
    }
  }
}

/** Run by name: loads, executes, heals (two levels), and appends to the run log. */
export async function runIntegration(
  name: string,
  rawInput: Record<string, unknown> = {},
  opts: RunOptions = {},
): Promise<RunResult> {
  const heal = opts.heal ?? true;
  let result: RunResult;
  let version = 0;
  try {
    const integ = loadIntegration(name, opts.integrationsDir);
    version = integ.version;
    result = await executeIntegration(integ, rawInput, opts);
    if (!result.ok && heal && result.kind === 'run') {
      // level 2: re-mint from the stored task/example, then retry once without healing
      try {
        const { mint } = await import('./mint/index.js');
        const { integration } = await mint({
          name: integ.name,
          url: integ.url,
          task: integ.task,
          exampleInput: integ.exampleInput,
          authority: integ.authority,
          auth: integ.auth ? { url: integ.auth.url, secretNames: integ.auth.secretNames } : undefined,
          previous: integ,
          reason: 'heal:remint',
          integrationsDir: opts.integrationsDir,
        });
        const retry = await executeIntegration(integration, rawInput, { ...opts, heal: false });
        retry.meta.healed = retry.ok ? 'remint' : null;
        retry.meta.ms = result.meta.ms + retry.meta.ms;
        result = retry;
        version = integration.version;
      } catch (e) {
        result.error += ` | remint failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
      }
    }
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      kind: 'run',
      meta: { name, version, ms: 0, healed: null, steps: 0 },
    };
  }
  try {
    appendRun({
      at: new Date().toISOString(),
      name,
      version: result.meta.version || version,
      ok: result.ok,
      ms: result.meta.ms,
      healed: result.meta.healed,
      ...(result.ok ? {} : { error: result.error }),
      inputKeys: Object.keys(rawInput ?? {}),
      resultCount: result.ok ? resultCount(result.results) : 0,
    });
  } catch {
    /* logging must never break a run */
  }
  return result;
}
