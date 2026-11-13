import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, type LanguageModel } from "ai";
import type { ZodType } from "zod";

export const DEFAULT_MODEL = "claude-opus-5-5";

export function isMockMode(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}

export function modelName(): string {
  return isMockMode() ? "mock" : (process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL);
}

export function getModel(): LanguageModel {
  const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return provider(process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL);
}

/** Structured generation against a zod schema (real-model path only). */
export async function generateStructured<T>(opts: {
  schema: ZodType<T>;
  system: string;
  prompt: string;
}): Promise<T> {
  const result = await generateText({
    model: getModel(),
    system: opts.system,
    prompt: opts.prompt,
    output: Output.object({ schema: opts.schema }),
  });
  return result.output as T;
}
