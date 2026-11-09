import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import type { z } from 'zod';

/** Mock mode when MOCK_LLM=1 or no API key is configured. */
export const MOCK_LLM = process.env.MOCK_LLM === '1' || !process.env.ANTHROPIC_API_KEY;
export const MODEL_ID = process.env.LLM_MODEL || 'claude-sonnet-5-5';
export const getModel = () => anthropic(MODEL_ID);

/** Structured output via AI SDK generateObject + a Zod schema. */
export async function structured<S extends z.ZodType>(schema: S, system: string, prompt: string): Promise<z.infer<S>> {
  const { object } = await generateObject({ model: getModel(), schema, system, prompt });
  return object as z.infer<S>;
}
