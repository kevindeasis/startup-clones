export type TestInput = { name: string; startUrl: string; steps: string[]; expectedOutcome: string };

/** Accepts steps as string[] or a newline-separated string. */
export function parseSteps(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(/\r?\n/) : [];
  return arr.map((s) => s.trim()).filter(Boolean);
}

export function parseTestInput(body: unknown): { ok: true; value: TestInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid JSON body' };
  const b = body as Record<string, unknown>;
  const name = String(b.name ?? '').trim();
  const startUrl = String(b.startUrl ?? '').trim();
  const steps = parseSteps(b.steps);
  const expectedOutcome = String(b.expectedOutcome ?? '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  try {
    const u = new URL(startUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return { ok: false, error: 'startUrl must be a valid http(s) URL' };
  }
  if (steps.length === 0) return { ok: false, error: 'at least one step is required' };
  return { ok: true, value: { name, startUrl, steps, expectedOutcome } };
}
