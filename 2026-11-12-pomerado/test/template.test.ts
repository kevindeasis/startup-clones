import { describe, expect, it } from 'vitest';
import { collectRefs, findMissing, render, secretEnvName } from '../src/template.js';

const ctx = { input: { query: 'bolt' }, url: 'http://x/y', integrationName: 'list_orders', env: { MINTER_SECRET_LIST_ORDERS_PASSWORD: 'pw' } as NodeJS.ProcessEnv };

describe('template', () => {
  it('renders input, url and secrets', () => {
    expect(render('{{url}}?q={{input.query}}', ctx)).toBe('http://x/y?q=bolt');
    expect(render('{{secret.PASSWORD}}', ctx)).toBe('pw');
  });
  it('throws on missing input and missing secret (naming only the env var)', () => {
    expect(() => render('{{input.nope}}', ctx)).toThrow(/missing input: nope/);
    expect(() => render('{{secret.USERNAME}}', ctx)).toThrow(/MINTER_SECRET_LIST_ORDERS_USERNAME/);
  });
  it('collects refs deeply and reports missing ones', () => {
    const v = { a: ['{{input.q}}', { b: '{{secret.USERNAME}}' }] };
    const r = collectRefs(v);
    expect([...r.inputs]).toEqual(['q']);
    expect([...r.secrets]).toEqual(['USERNAME']);
    expect(findMissing(v, { input: {}, integrationName: 'list_orders', env: {} })).toEqual({
      missingInputs: ['q'],
      missingSecrets: ['MINTER_SECRET_LIST_ORDERS_USERNAME'],
    });
  });
  it('builds env names', () => expect(secretEnvName('list_orders', 'password')).toBe('MINTER_SECRET_LIST_ORDERS_PASSWORD'));
});
