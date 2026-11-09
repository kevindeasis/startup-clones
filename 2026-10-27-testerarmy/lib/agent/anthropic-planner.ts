import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { decisionSchema, verdictSchema, type Action, type Observation } from './actions';
import type { Planner } from './planner';

const SYSTEM =
  'You are a QA tester driving a browser. You are given the current step, the page\'s accessibility snapshot, and the actions already taken for this step. Return exactly ONE next action. Prefer accessible names exactly as they appear in the snapshot. Return `done` as soon as the step is satisfied; return `fail` if it cannot be satisfied after honest attempts.';

const VERDICT_SYSTEM =
  'You are a QA tester judging the end state of a test run. Given the final page accessibility snapshot, URL, and the expected outcome, return { pass, reason }. Be strict: pass only if the snapshot supports the expected outcome.';

function describe(obs: Observation) {
  return [
    `Current URL: ${obs.url}`,
    `Title: ${obs.title}`,
    `All steps:\n${obs.allSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `Expected outcome of the whole test: ${obs.expectedOutcome}`,
    `Current step: ${obs.stepInstruction}`,
    `Actions already taken for this step:\n${
      obs.previousActionsInStep.length
        ? obs.previousActionsInStep
            .map((a) => `- ${JSON.stringify(a.action)} -> ${a.ok ? 'ok' : 'ERROR: ' + a.error}`)
            .join('\n')
        : '(none)'
    }`,
    `Accessibility snapshot:\n${obs.ariaSnapshot}`,
  ].join('\n\n');
}

export class AnthropicPlanner implements Planner {
  name = 'anthropic' as const;
  private model: ReturnType<ReturnType<typeof createAnthropic>>;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY, modelId = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5') {
    const anthropic = createAnthropic({ apiKey });
    this.model = anthropic(modelId);
  }

  async decide(obs: Observation): Promise<{ action: Action; reasoning: string }> {
    const { object } = await generateObject({
      model: this.model,
      schema: decisionSchema,
      system: SYSTEM,
      prompt: describe(obs),
    });
    return object;
  }

  async verdict(obs: Observation): Promise<{ pass: boolean; reason: string }> {
    const { object } = await generateObject({
      model: this.model,
      schema: verdictSchema,
      system: VERDICT_SYSTEM,
      prompt: describe(obs),
    });
    return object;
  }
}
