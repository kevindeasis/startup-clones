import { getConfig, isMockMode } from '../config.js';
import { IntegrationSchema, NAME_RE, saveIntegration, type Integration, type IntegrationCore } from '../integration.js';
import { executeIntegration, resultCount, type RunResult } from '../runner.js';
import { exploreMock } from './explore-mock.js';
import { generaliseMock } from './generalise-mock.js';
import type { ExploreInput } from './types.js';

export interface MintOptions {
  name: string;
  url: string;
  task: string;
  exampleInput: Record<string, string>;
  authority?: 'read' | 'write';
  auth?: { url: string; secretNames: string[] };
  /** set on re-mint: keeps createdAt/history and bumps the version */
  previous?: Integration;
  reason?: string;
  integrationsDir?: string;
  log?: (m: string) => void;
}

export async function mint(opts: MintOptions): Promise<{ integration: Integration; sample: RunResult }> {
  if (!NAME_RE.test(opts.name)) throw new Error(`invalid name "${opts.name}" (must match ${NAME_RE})`);
  const log = opts.log ?? ((m: string) => console.error(`[mint] ${m}`));
  const mock = isMockMode();
  log(mock ? 'mock mode: heuristic explorer, no model (set ANTHROPIC_API_KEY for real mode)' : `real mode: ${getConfig().model}`);
  const exampleInput = Object.fromEntries(Object.entries(opts.exampleInput).map(([k, v]) => [k, String(v)]));
  const authority = opts.authority ?? 'read';
  const exploreIn: ExploreInput = { name: opts.name, url: opts.url, task: opts.task, exampleInput, auth: opts.auth, log };
  const genIn = { name: opts.name, task: opts.task, authority, exampleInput };

  const finish = (core: IntegrationCore): Integration => {
    const now = new Date().toISOString();
    const prev = opts.previous;
    const version = prev ? prev.version + 1 : 1;
    return IntegrationSchema.parse({
      ...core,
      version,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      history: [...(prev?.history ?? []), { version, at: now, reason: opts.reason ?? 'mint' }],
    });
  };

  const rec = mock ? await exploreMock(exploreIn) : await (await import('./explore-llm.js')).exploreLlm(exploreIn);
  let core = mock ? generaliseMock(genIn, rec) : await (await import('./generalise-llm.js')).generaliseLlm(genIn, rec);
  let integration = finish(core);

  log('verifying: running the new integration once with the example input');
  let sample = await executeIntegration(integration, exampleInput, { heal: false, persist: false });
  if ((!sample.ok || resultCount(sample.results) < 1) && !mock) {
    const err = sample.ok ? 'verification run returned no results' : sample.error!;
    log(`verification failed (${err}); retrying generalise once`);
    core = await (await import('./generalise-llm.js')).generaliseLlm(genIn, rec, err, core);
    integration = finish(core);
    sample = await executeIntegration(integration, exampleInput, { heal: false, persist: false });
  }
  if (!sample.ok) throw new Error(`verification run failed: ${sample.error}`);
  if (resultCount(sample.results) < 1) throw new Error('verification run returned no results');

  saveIntegration(integration, opts.integrationsDir);
  log(`saved ${opts.name} v${integration.version}`);
  return { integration, sample };
}
