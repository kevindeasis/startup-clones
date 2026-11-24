import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ZodType } from "zod";
import { mockFor } from "./mock";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export function isMock(): boolean {
  return !process.env.ANTHROPIC_API_KEY || process.env.MOCK_LLM === "1";
}

export type GenerateOpts<T> = {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  name: string;
  /** Raw inputs used by the deterministic mock mode. */
  input?: unknown;
};

/**
 * Structured output. Real mode: AI SDK `generateObject` (exists in ai v7) with a zod schema.
 * Mock mode: deterministic fixture from lib/mock keyed by `name`, derived from `input`.
 */
export async function generateJSON<T>(opts: GenerateOpts<T>): Promise<T> {
  if (isMock()) {
    const out = mockFor(opts.name, opts.input);
    return opts.schema.parse(out);
  }
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await generateObject({
    model: anthropic(MODEL),
    schema: opts.schema,
    schemaName: opts.name,
    system: opts.system,
    prompt: opts.prompt,
  });
  return res.object as T;
}
