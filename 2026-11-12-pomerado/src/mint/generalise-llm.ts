import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { getConfig } from '../config.js';
import { IntegrationCoreSchema, type IntegrationCore } from '../integration.js';
import type { GeneraliseInput } from './generalise-mock.js';
import type { Recording } from './types.js';

/** Real-mode generalisation: recording -> integration JSON via structured output. */
export async function generaliseLlm(
  inp: GeneraliseInput,
  rec: Recording,
  previousError?: string,
  previous?: IntegrationCore,
): Promise<IntegrationCore> {
  const cfg = getConfig();
  const anthropic = createAnthropic({ apiKey: cfg.apiKey });
  const recording = {
    startUrl: rec.startUrl,
    auth: rec.auth,
    actions: rec.actions.map(({ snapshotBefore: _s, ...a }) => a),
  };
  const result = await generateText({
    model: anthropic(cfg.model),
    output: Output.object({ schema: IntegrationCoreSchema }),
    system:
      'You turn a recorded browser run into a deterministic, parameterised integration. Rules: ' +
      'every literal value equal to an example input value becomes {{input.<key>}}; secrets stay {{secret.NAME}} and credentials never appear; ' +
      'keep selectors and hints exactly as recorded; start with a goto {{url}} step; add one waitFor after each navigation-causing click; ' +
      'end with the recorded extract step(s); describe each input key in inputSchema; the name must be exactly the given name.',
    prompt:
      `Name: ${inp.name}\nTask: ${inp.task}\nAuthority: ${inp.authority}\nExample input: ${JSON.stringify(inp.exampleInput)}\n` +
      `Recording:\n${JSON.stringify(recording, null, 2)}` +
      (previousError ? `\n\nYour previous attempt failed verification with: ${previousError}\nPrevious attempt:\n${JSON.stringify(previous)}\nFix it.` : ''),
  });
  return IntegrationCoreSchema.parse({ ...result.output, name: inp.name, authority: inp.authority, exampleInput: inp.exampleInput });
}
