import type { Action, Observation } from './actions';
import type { Planner } from './planner';
import { parseStep, MOCK_CANNOT_INTERPRET } from './parse';

export class MockPlanner implements Planner {
  name = 'mock' as const;

  async decide(obs: Observation): Promise<{ action: Action; reasoning: string }> {
    const prev = obs.previousActionsInStep;
    if (prev.length > 0) {
      const last = prev[prev.length - 1];
      if (last.ok) return { action: { type: 'done', summary: 'action executed' }, reasoning: 'step action succeeded' };
      return { action: { type: 'fail', reason: last.error ?? 'action failed' }, reasoning: 'previous action failed' };
    }
    const parsed = parseStep(obs.stepInstruction);
    if (!parsed) {
      return { action: { type: 'fail', reason: MOCK_CANNOT_INTERPRET }, reasoning: 'unparseable step' };
    }
    return { action: parsed, reasoning: `rule-based parse of: ${obs.stepInstruction}` };
  }

  /** Verdict evaluates assertions against the final page text / url. */
  async verdict(obs: Observation): Promise<{ pass: boolean; reason: string }> {
    const parsed = parseStep(obs.expectedOutcome);
    const body = (obs.pageText ?? '') + '\n' + obs.ariaSnapshot;
    if (parsed?.type === 'assert_text') {
      const ok = body.toLowerCase().includes((parsed.text ?? '').toLowerCase());
      return {
        pass: ok,
        reason: ok ? `page contains "${parsed.text}"` : `expected page to contain "${parsed.text}" but it did not (expected "${parsed.text}")`,
      };
    }
    if (parsed?.type === 'assert_url_contains') {
      const ok = obs.url.includes(parsed.fragment ?? '');
      return { pass: ok, reason: ok ? `url contains "${parsed.fragment}"` : `url ${obs.url} does not contain "${parsed.fragment}"` };
    }
    return { pass: true, reason: 'all steps passed (expected outcome not machine-checkable by mock planner)' };
  }
}
