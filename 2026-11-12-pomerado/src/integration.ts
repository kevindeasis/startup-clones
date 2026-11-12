import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getConfig } from './config.js';

export const NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;

export const HintsSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  text: z.string().optional(),
  tag: z.string().optional(),
});
export const TargetSchema = z.object({ selector: z.string().min(1), hints: HintsSchema });
export type Target = z.infer<typeof TargetSchema>;

const FieldSpec = z.object({ selector: z.string(), attr: z.string() });

export const StepSchema = z.union([
  z.object({ type: z.literal('goto'), url: z.string() }),
  z.object({ type: z.literal('fill'), target: TargetSchema, value: z.string() }),
  z.object({ type: z.literal('click'), target: TargetSchema }),
  z.object({ type: z.literal('press'), target: TargetSchema, key: z.string() }),
  z.object({ type: z.literal('select'), target: TargetSchema, value: z.string() }),
  z.object({ type: z.literal('waitFor'), target: TargetSchema }),
  z.object({ type: z.literal('waitForUrl'), contains: z.string() }),
  z.object({ type: z.literal('extract'), mode: z.literal('table'), target: TargetSchema, as: z.string() }),
  z.object({
    type: z.literal('extract'),
    mode: z.literal('list'),
    target: TargetSchema,
    item: z.string(),
    fields: z.record(z.string(), FieldSpec),
    as: z.string(),
  }),
  z.object({ type: z.literal('extract'), mode: z.literal('text'), target: TargetSchema, as: z.string() }),
]);
export type Step = z.infer<typeof StepSchema>;

export const SuccessCheckSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('urlNotContains'), value: z.string() }),
  z.object({ type: z.literal('visible'), target: TargetSchema }),
]);

export const AuthSchema = z.object({
  url: z.string(),
  fields: z.array(z.object({ target: TargetSchema, value: z.string() })),
  submit: TargetSchema,
  successCheck: SuccessCheckSchema,
  secretNames: z.array(z.string()),
});
export type Auth = z.infer<typeof AuthSchema>;

export const InputSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.object({ type: z.literal('string'), description: z.string().optional() })),
  required: z.array(z.string()).optional(),
});

/** Everything the generalise step produces (no timestamps/history/version). */
export const IntegrationCoreSchema = z.object({
  name: z.string().regex(NAME_RE),
  description: z.string(),
  url: z.string(),
  task: z.string(),
  authority: z.enum(['read', 'write']),
  exampleInput: z.record(z.string(), z.string()),
  inputSchema: InputSchemaSchema,
  auth: AuthSchema.nullable(),
  steps: z.array(StepSchema).min(1),
  output: z.object({ shape: z.string(), columns: z.array(z.string()).optional() }),
});
export type IntegrationCore = z.infer<typeof IntegrationCoreSchema>;

export const IntegrationSchema = IntegrationCoreSchema.extend({
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(z.object({ version: z.number(), at: z.string(), reason: z.string() })),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export function integrationPath(name: string, dir = getConfig().integrationsDir): string {
  return join(dir, name, 'integration.json');
}

export function loadIntegration(name: string, dir = getConfig().integrationsDir): Integration {
  if (!NAME_RE.test(name)) throw new Error(`invalid integration name: ${name}`);
  const p = integrationPath(name, dir);
  if (!existsSync(p)) throw new Error(`integration not found: ${name}`);
  return IntegrationSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export function saveIntegration(integ: Integration, dir = getConfig().integrationsDir): void {
  const parsed = IntegrationSchema.parse(integ);
  mkdirSync(join(dir, parsed.name), { recursive: true });
  writeFileSync(integrationPath(parsed.name, dir), JSON.stringify(parsed, null, 2) + '\n');
}

export function listIntegrations(dir = getConfig().integrationsDir): Integration[] {
  if (!existsSync(dir)) return [];
  const out: Integration[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      out.push(loadIntegration(d.name, dir));
    } catch {
      /* skip invalid files */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Bump version + history after a heal (mutates and saves). */
export function recordVersion(integ: Integration, reason: string, dir?: string): void {
  integ.version += 1;
  integ.updatedAt = new Date().toISOString();
  integ.history.push({ version: integ.version, at: integ.updatedAt, reason });
  saveIntegration(integ, dir);
}
