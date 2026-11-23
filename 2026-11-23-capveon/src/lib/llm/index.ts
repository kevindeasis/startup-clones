import { liveLLM, modelId } from "./live";
import { mockLLM } from "./mock";
import type { LLM } from "./types";

export type { LLM } from "./types";

/** live iff ANTHROPIC_API_KEY is set and LLM_MODE is not "mock"; everything else is mock. */
export function getMode(): "mock" | "live" {
  const forced = (process.env.LLM_MODE || "").toLowerCase();
  if (forced === "mock") return "mock";
  return process.env.ANTHROPIC_API_KEY ? "live" : "mock";
}

export function getLLM(): LLM {
  return getMode() === "live" ? liveLLM : mockLLM;
}

export function modelLabel(): string {
  return getMode() === "live" ? modelId() : "mock-heuristics";
}
