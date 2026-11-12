/** {{input.x}} / {{secret.X}} / {{url}} rendering. Secrets come from env only. */
const RE = /\{\{\s*(?:(input|secret)\.([A-Za-z0-9_]+)|(url))\s*\}\}/g;

export function secretEnvName(integrationName: string, key: string): string {
  return 'MINTER_SECRET_' + integrationName.toUpperCase() + '_' + key.toUpperCase();
}

export interface Refs {
  inputs: Set<string>;
  secrets: Set<string>;
}

/** Walk any JSON value and collect template references. */
export function collectRefs(value: unknown, refs: Refs = { inputs: new Set(), secrets: new Set() }): Refs {
  if (typeof value === 'string') {
    for (const m of value.matchAll(RE)) {
      if (m[1] === 'input') refs.inputs.add(m[2]);
      else if (m[1] === 'secret') refs.secrets.add(m[2]);
    }
  } else if (Array.isArray(value)) value.forEach((v) => collectRefs(v, refs));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectRefs(v, refs));
  return refs;
}

export interface RenderContext {
  input: Record<string, string>;
  url: string;
  integrationName: string;
  env?: NodeJS.ProcessEnv;
}

export function render(template: string, ctx: RenderContext): string {
  const env = ctx.env ?? process.env;
  return template.replace(RE, (_m, kind: string | undefined, key: string | undefined, isUrl: string | undefined) => {
    if (isUrl) return ctx.url;
    if (kind === 'input') {
      if (!(key! in ctx.input)) throw new Error(`missing input: ${key}`);
      return ctx.input[key!];
    }
    const name = secretEnvName(ctx.integrationName, key!);
    const v = env[name];
    if (v === undefined || v === '') throw new Error(`missing secret: ${name}`);
    return v;
  });
}

/** Fail-fast check: returns human readable problems (never secret values). */
export function findMissing(
  value: unknown,
  ctx: { input: Record<string, string>; integrationName: string; env?: NodeJS.ProcessEnv },
): { missingInputs: string[]; missingSecrets: string[] } {
  const env = ctx.env ?? process.env;
  const refs = collectRefs(value);
  const missingInputs = [...refs.inputs].filter((k) => !(k in ctx.input));
  const missingSecrets = [...refs.secrets]
    .map((k) => secretEnvName(ctx.integrationName, k))
    .filter((n) => !env[n]);
  return { missingInputs, missingSecrets };
}
