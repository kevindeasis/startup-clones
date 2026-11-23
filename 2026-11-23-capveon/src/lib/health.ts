import { getMode, modelLabel } from "./llm";
import { seedCounts } from "./seed";

export async function healthInfo() {
  return { ok: true, mode: getMode(), model: modelLabel(), counts: await seedCounts() };
}
