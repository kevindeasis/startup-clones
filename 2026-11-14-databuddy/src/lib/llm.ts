import { createAnthropic } from "@ai-sdk/anthropic";

export const isMockMode = (): boolean => !process.env.ANTHROPIC_API_KEY;
export const modelName = (): string => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export function getModel() {
  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelName());
}
