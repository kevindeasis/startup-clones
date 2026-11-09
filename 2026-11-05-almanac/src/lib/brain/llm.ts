import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createMockModel } from "./mock";

export type Provider = "anthropic" | "mock";

export function getProvider(): Provider {
  if (process.env.LLM_PROVIDER === "mock") return "mock";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";
}

export function getModel(): { model: LanguageModel; provider: Provider } {
  const provider = getProvider();
  if (provider === "mock") return { model: createMockModel(), provider };
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return { model: anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5"), provider };
}
