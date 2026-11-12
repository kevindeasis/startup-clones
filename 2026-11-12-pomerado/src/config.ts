import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root (works from src/ via tsx and from dist/ after tsc). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  const envFile = resolve(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
} catch {
  /* a malformed .env must not crash the tool */
}

const nonEmpty = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/** Read config lazily so tests can change process.env between calls. */
export function getConfig() {
  const e = process.env;
  return {
    root: ROOT,
    apiKey: nonEmpty(e.ANTHROPIC_API_KEY),
    model: nonEmpty(e.ANTHROPIC_MODEL) ?? 'claude-opus-5-5',
    forceMock: e.MINTER_MOCK === '1',
    port: Number(nonEmpty(e.MINTER_PORT) ?? 4311),
    integrationsDir: resolve(ROOT, nonEmpty(e.MINTER_INTEGRATIONS_DIR) ?? './integrations'),
    dataDir: resolve(ROOT, nonEmpty(e.MINTER_DATA_DIR) ?? './data'),
    chromiumPath: nonEmpty(e.MINTER_CHROMIUM_PATH),
    demoPort: Number(nonEmpty(e.DEMO_SITE_PORT) ?? 4310),
    demoVersion: nonEmpty(e.DEMO_SITE_VERSION) === '2' ? 2 : 1,
    demoUser: nonEmpty(e.DEMO_USER) ?? 'demo',
    demoPass: nonEmpty(e.DEMO_PASS) ?? 'demo-pass',
  };
}

/** Real mode needs an API key and MINTER_MOCK not set to 1. */
export function isMockMode(): boolean {
  const c = getConfig();
  return c.forceMock || !c.apiKey;
}
