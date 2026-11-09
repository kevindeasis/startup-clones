import { describe, it, expect } from 'vitest';
import { parseStep, MOCK_CANNOT_INTERPRET } from '@/lib/agent/parse';
import { MockPlanner } from '@/lib/agent/mock-planner';
import { parseSteps, parseTestInput } from '@/lib/validate';
import { resolveArtifact } from '@/lib/artifact-path';
import type { Observation } from '@/lib/agent/actions';

const obs = (o: Partial<Observation>): Observation => ({
  url: 'http://x/demo', title: '', ariaSnapshot: '', stepInstruction: '', previousActionsInStep: [],
  allSteps: [], expectedOutcome: '', ...o,
});

describe('parseStep', () => {
  it('parses fill variants', () => {
    expect(parseStep('Type "demo" into the "Username" field')).toEqual({ type: 'fill', value: 'demo', target: 'Username' });
    expect(parseStep('enter "x" in Email')).toEqual({ type: 'fill', value: 'x', target: 'Email' });
    expect(parseStep('Fill Password with hunter2')).toEqual({ type: 'fill', target: 'Password', value: 'hunter2' });
  });
  it('parses click', () => {
    expect(parseStep('Click the "Sign in" button')).toEqual({ type: 'click', target: 'Sign in' });
    expect(parseStep('click on Pricing link')).toEqual({ type: 'click', target: 'Pricing' });
    expect(parseStep('Click the "Buy milk" checkbox')).toEqual({ type: 'click', target: 'Buy milk' });
  });
  it('parses goto/press/select/wait/asserts', () => {
    expect(parseStep('Go to http://a.b/c')).toEqual({ type: 'goto', url: 'http://a.b/c' });
    expect(parseStep('press Enter')).toEqual({ type: 'press', key: 'Enter' });
    expect(parseStep('Select "Red" in Color')).toEqual({ type: 'select', value: 'Red', target: 'Color' });
    expect(parseStep('wait 2 seconds')).toEqual({ type: 'wait', ms: 2000 });
    expect(parseStep('Verify that "Buy milk" is visible')).toEqual({ type: 'assert_text', text: 'Buy milk' });
    expect(parseStep('The page contains "1 items left"')).toEqual({ type: 'assert_text', text: '1 items left' });
    expect(parseStep('url contains "demo"')).toEqual({ type: 'assert_url_contains', fragment: 'demo' });
  });
  it('returns null for gibberish', () => expect(parseStep('make it pretty')).toBeNull());
});

describe('MockPlanner', () => {
  const p = new MockPlanner();
  it('acts then is done', async () => {
    const a = await p.decide(obs({ stepInstruction: 'Click the "Add" button' }));
    expect(a.action).toEqual({ type: 'click', target: 'Add' });
    const b = await p.decide(obs({ stepInstruction: 'x', previousActionsInStep: [{ action: a.action, ok: true }] }));
    expect(b.action.type).toBe('done');
  });
  it('fails on unknown steps', async () => {
    const a = await p.decide(obs({ stepInstruction: 'make it pretty' }));
    expect(a.action).toEqual({ type: 'fail', reason: MOCK_CANNOT_INTERPRET });
  });
  it('verdict evaluates assert_text', async () => {
    const e = 'The page contains "0 items left"';
    expect((await p.verdict(obs({ expectedOutcome: e, pageText: '1 items left' }))).pass).toBe(false);
    expect((await p.verdict(obs({ expectedOutcome: e, pageText: '0 items left' }))).pass).toBe(true);
    expect((await p.verdict(obs({ expectedOutcome: 'it works' }))).pass).toBe(true);
  });
});

describe('helpers', () => {
  it('parses steps', () => expect(parseSteps('a\n\n b \r\nc')).toEqual(['a', 'b', 'c']));
  it('validates test input', () => {
    expect(parseTestInput({ name: '', startUrl: 'http://a', steps: 'x' }).ok).toBe(false);
    expect(parseTestInput({ name: 'n', startUrl: 'nope', steps: 'x' }).ok).toBe(false);
    expect(parseTestInput({ name: 'n', startUrl: 'http://a', steps: 'x', expectedOutcome: '' }).ok).toBe(true);
  });
  it('rejects path traversal', () => {
    expect(resolveArtifact('/data', ['..', 'etc', 'passwd.png'])).toBeNull();
    expect(resolveArtifact('/data', ['runs', 'a', 'x.txt'])).toBeNull();
    expect(resolveArtifact('/data', ['runs', 'a', 'x.png'])?.type).toBe('image/png');
  });
});
