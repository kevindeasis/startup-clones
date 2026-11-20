export type LlmMode = "mock" | "live";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** LLM_MODE=mock|live|auto (default auto = live iff ANTHROPIC_API_KEY is set). */
export function resolveMode(env: Record<string, string | undefined> = process.env): LlmMode {
  const requested = (env.LLM_MODE ?? "auto").trim().toLowerCase();
  if (requested === "mock") return "mock";
  if (requested === "live") return "live";
  return env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim() ? "live" : "mock";
}

export function resolveModel(env: Record<string, string | undefined> = process.env): string {
  return env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}
