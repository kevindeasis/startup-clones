import { generateObject } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { z } from "zod";

export function llmMode(): "mock" | "anthropic" {
  if (process.env.LLM_PROVIDER === "mock") return "mock";
  if (!process.env.ANTHROPIC_API_KEY) return "mock";
  return "anthropic";
}

export function getModel() {
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5");
}

/**
 * The only entry point the app uses for LLM calls. In mock mode `mock()` supplies the
 * output; either way the result is validated with the zod schema and retried once.
 */
export async function runStructured<S extends z.ZodType>(opts: {
  name: string;
  schema: S;
  system: string;
  prompt: string;
  mock: () => unknown;
}): Promise<z.infer<S>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (llmMode() === "mock") return opts.schema.parse(opts.mock());
      const { object } = await generateObject({
        model: getModel(),
        schema: opts.schema,
        schemaName: opts.name,
        system: opts.system,
        prompt: opts.prompt,
      });
      return opts.schema.parse(object);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
