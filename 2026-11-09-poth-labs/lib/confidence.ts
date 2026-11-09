export type Stance = "supports" | "contradicts" | "neutral";

export const SUPPORT_DELTA = 0.1;
export const CONTRADICT_DELTA = -0.15;
export const MIN_CONF = 0.02;
export const MAX_CONF = 0.98;

export function updateConfidence(current: number, stance: Stance): number {
  const delta = stance === "supports" ? SUPPORT_DELTA : stance === "contradicts" ? CONTRADICT_DELTA : 0;
  const next = current + delta;
  return Math.round(Math.min(MAX_CONF, Math.max(MIN_CONF, next)) * 1000) / 1000;
}
