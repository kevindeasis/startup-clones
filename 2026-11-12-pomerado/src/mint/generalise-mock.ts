import type { IntegrationCore, Step, Target } from '../integration.js';
import type { Recording } from './types.js';

export interface GeneraliseInput {
  name: string;
  task: string;
  authority: 'read' | 'write';
  exampleInput: Record<string, string>;
}

/** Rule based generalisation: literal example values -> {{input.key}}, derive schema, add waitFor. */
export function generaliseMock(inp: GeneraliseInput, rec: Recording): IntegrationCore {
  const keyOfValue = new Map<string, string>();
  for (const [k, v] of Object.entries(inp.exampleInput)) if (!keyOfValue.has(v)) keyOfValue.set(v, k);
  const tpl = (v: string) => (keyOfValue.has(v) ? `{{input.${keyOfValue.get(v)}}}` : v);

  const properties: IntegrationCore['inputSchema']['properties'] = {};
  for (const k of Object.keys(inp.exampleInput)) properties[k] = { type: 'string', description: `Value for "${k}"` };
  for (const a of rec.actions) {
    if (a.inputKey && properties[a.inputKey]) {
      properties[a.inputKey].description = a.label ? `${a.label} (e.g. "${inp.exampleInput[a.inputKey]}")` : properties[a.inputKey].description;
    }
  }

  const steps: Step[] = [{ type: 'goto', url: '{{url}}' }];
  let columns: string[] | undefined;
  let shape = 'text';
  for (const a of rec.actions) {
    const t = a.target as Target;
    switch (a.type) {
      case 'fill':
        steps.push({ type: 'fill', target: t, value: tpl(a.value ?? '') });
        break;
      case 'select':
        steps.push({ type: 'select', target: t, value: tpl(a.value ?? '') });
        break;
      case 'click':
        steps.push({ type: 'click', target: t });
        break;
      case 'press':
        steps.push({ type: 'press', target: t, key: a.key ?? 'Enter' });
        break;
      case 'extract':
        steps.push({ type: 'waitFor', target: t });
        if (a.mode === 'table') {
          steps.push({ type: 'extract', mode: 'table', target: t, as: a.as ?? 'rows' });
          shape = 'rows';
          const m = a.snapshotBefore.match(/table .*headers=\[([^\]]*)\]/);
          if (m) columns = m[1].split(',').map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
        } else if (a.mode === 'list') {
          steps.push({ type: 'extract', mode: 'list', target: t, item: a.item ?? ':scope > li', fields: a.fields ?? {}, as: a.as ?? 'items' });
          shape = 'items';
        } else steps.push({ type: 'extract', mode: 'text', target: t, as: a.as ?? 'message' });
        break;
    }
  }

  const auth = rec.auth
    ? {
        url: rec.auth.url,
        fields: rec.auth.fields.map((f) => ({ target: f.target, value: `{{secret.${f.secret}}}` })),
        submit: rec.auth.submit,
        successCheck: rec.auth.successCheck,
        secretNames: rec.auth.secretNames,
      }
    : null;

  return {
    name: inp.name,
    description: inp.task,
    url: rec.startUrl,
    task: inp.task,
    authority: inp.authority,
    exampleInput: inp.exampleInput,
    inputSchema: { type: 'object', properties, required: Object.keys(inp.exampleInput) },
    auth,
    steps,
    output: { shape, ...(columns ? { columns } : {}) },
  };
}
