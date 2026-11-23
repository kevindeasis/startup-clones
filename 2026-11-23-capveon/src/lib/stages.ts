import { STAGES, type Stage, type Signal, type Source } from "./types";
import { normalizeWs } from "./util";

export function stageRank(s: Stage): number {
  return STAGES.indexOf(s);
}
export function laterStage(a: Stage, b: Stage): Stage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

const STOP = new Set(["the", "a", "an", "of", "and", "for", "to", "project", "program", "phase", "no", "city", "town", "county"]);

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 ? t.replace(/(ies|es|s)$/, "") : t));
}

export function normalizeTitle(title: string): string {
  return titleTokens(title).join(" ");
}

/** Near-identical title test: token Jaccard >= 0.6, or one token set contains the other (min 2 tokens). */
export function titlesMatch(a: string, b: string): boolean {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (!ta.size || !tb.size) return false;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  if (inter / union >= 0.6) return true;
  const small = ta.size <= tb.size ? ta : tb;
  return small.size >= 3 && inter === small.size;
}

export function findMatchingSignal<T extends Pick<Signal, "agencyId" | "projectTitle">>(
  existing: T[],
  agencyId: string,
  title: string,
): T | undefined {
  return existing.find((s) => s.agencyId === agencyId && titlesMatch(s.projectTitle, title));
}

export function addSource(sources: Source[], s: Source): Source[] {
  if (sources.some((x) => x.documentId === s.documentId && x.page === s.page)) return sources;
  return [...sources, s];
}

type Mergeable = Pick<
  Signal,
  "stage" | "estimatedValue" | "valueText" | "timing" | "summary" | "confidence" | "sources" | "category"
>;

/**
 * Merge a new observation into an existing signal: keep the later stage, take the newer value/timing
 * when the new observation is of the later (or same) stage, and append the new sources.
 */
export function mergeSignal<T extends Mergeable>(existing: T, incoming: Mergeable): T {
  const stage = laterStage(existing.stage, incoming.stage);
  const incomingWins = stageRank(incoming.stage) >= stageRank(existing.stage);
  let sources = existing.sources;
  for (const s of incoming.sources) sources = addSource(sources, s);
  return {
    ...existing,
    stage,
    estimatedValue: incomingWins ? (incoming.estimatedValue ?? existing.estimatedValue) : (existing.estimatedValue ?? incoming.estimatedValue),
    valueText: incomingWins ? (incoming.valueText ?? existing.valueText) : (existing.valueText ?? incoming.valueText),
    timing: incomingWins ? (incoming.timing ?? existing.timing) : (existing.timing ?? incoming.timing),
    summary: incomingWins ? normalizeWs(incoming.summary) || existing.summary : existing.summary,
    confidence: Math.max(existing.confidence, incoming.confidence),
    sources,
  };
}

export function compareSignals(a: Pick<Signal, "fitScore" | "stage">, b: Pick<Signal, "fitScore" | "stage">): number {
  return b.fitScore - a.fitScore || stageRank(b.stage) - stageRank(a.stage);
}
