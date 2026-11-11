import { PATTERNS, type Feedback, type Pattern, type Scenario, type Session, type Unit, type Verdict } from "./schemas";

export type ScenarioState = "locked" | "unlocked" | "completed";
export const CUSTOM_UNIT_ID = "custom";

/** Lesson N+1 unlocks when N is done; unit N+1 unlocks when unit N is completed. Custom scenarios are always open. */
export function scenarioStates(units: Unit[], scenarios: Scenario[], completed: Iterable<string>): Record<string, ScenarioState> {
  const done = new Set(completed);
  const out: Record<string, ScenarioState> = {};
  const ordered = [...units].filter((u) => u.id !== CUSTOM_UNIT_ID).sort((a, b) => a.order - b.order);
  let previousUnitComplete = true;
  for (const unit of ordered) {
    const lessons = scenarios.filter((s) => s.unitId === unit.id).sort((a, b) => a.order - b.order);
    let previousLessonComplete = true;
    for (const s of lessons) {
      if (done.has(s.id)) out[s.id] = "completed";
      else out[s.id] = previousUnitComplete && previousLessonComplete ? "unlocked" : "locked";
      previousLessonComplete = done.has(s.id);
    }
    previousUnitComplete = previousUnitComplete && lessons.every((s) => done.has(s.id));
  }
  for (const s of scenarios) {
    if (!(s.id in out)) out[s.id] = done.has(s.id) ? "completed" : "unlocked";
  }
  return out;
}

/** First unlocked, not-yet-completed scenario in curriculum order (custom excluded). */
export function nextScenarioId(units: Unit[], scenarios: Scenario[], states: Record<string, ScenarioState>): string | null {
  const ordered = [...units].filter((u) => u.id !== CUSTOM_UNIT_ID).sort((a, b) => a.order - b.order);
  for (const unit of ordered) {
    for (const s of scenarios.filter((x) => x.unitId === unit.id).sort((a, b) => a.order - b.order)) {
      if (states[s.id] === "unlocked") return s.id;
    }
  }
  return null;
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + delta));
}

/** Consecutive calendar days with >=1 session, ending today (or yesterday, so the streak survives until you miss a full day). */
export function streakDays(dayKeys: string[], today: string): number {
  const days = new Set(dayKeys);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n++;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

export function patternCounts(feedbacks: Feedback[]): Partial<Record<Pattern, number>> {
  const counts: Partial<Record<Pattern, number>> = {};
  for (const f of feedbacks) counts[f.pattern] = (counts[f.pattern] ?? 0) + 1;
  return counts;
}

/** Most frequent pattern other than "fine"; ties broken by PATTERNS order. */
export function topPattern(counts: Partial<Record<Pattern, number>>): Pattern | null {
  let best: Pattern | null = null;
  for (const p of PATTERNS) {
    if (p === "fine") continue;
    const c = counts[p] ?? 0;
    if (c > 0 && (best === null || c > (counts[best] ?? 0))) best = p;
  }
  return best;
}

export interface Progress {
  completedScenarioIds: string[];
  streakDays: number;
  patternCounts: Partial<Record<Pattern, number>>;
  topPattern: Pattern | null;
  sessions: { id: string; scenarioId: string; endedAt: string; score: number; pattern: Pattern }[];
}

export function deriveProgress(sessions: Session[], today: string): Progress {
  const done = sessions.filter((s) => s.feedback);
  const counts = patternCounts(done.map((s) => s.feedback!));
  return {
    completedScenarioIds: [...new Set(done.map((s) => s.scenarioId))],
    streakDays: streakDays(done.map((s) => dayKey(new Date(s.endedAt ?? s.startedAt))), today),
    patternCounts: counts,
    topPattern: topPattern(counts),
    sessions: done
      .map((s) => ({ id: s.id, scenarioId: s.scenarioId, endedAt: s.endedAt ?? s.startedAt, score: s.feedback!.score, pattern: s.feedback!.pattern }))
      .sort((a, b) => b.endedAt.localeCompare(a.endedAt)),
  };
}

const VERDICT_SCORE: Record<Verdict, number> = { landed: 100, okay: 65, backfired: 30 };
export const verdictScore = (v: Verdict) => VERDICT_SCORE[v];

/** Validate/normalise LLM feedback against the user line indexes. Returns null if unusable. */
export function normalizeFeedback(
  raw: { score: number; summary: string; weakest_line_index: number; pattern: Pattern; lines: Feedback["lines"] },
  userIndexes: number[],
): Feedback | null {
  const byIndex = new Map(raw.lines.map((l) => [l.index, l]));
  const lines: Feedback["lines"] = [];
  for (const i of userIndexes) {
    const l = byIndex.get(i);
    if (!l) return null;
    lines.push({ index: i, verdict: l.verdict, reason: l.reason, ...(l.verdict !== "landed" && l.stronger ? { stronger: l.stronger } : {}) });
  }
  let weakest = raw.weakest_line_index;
  if (!userIndexes.includes(weakest)) {
    weakest = [...lines].sort((a, b) => verdictScore(a.verdict) - verdictScore(b.verdict))[0]?.index ?? userIndexes[0];
  }
  return {
    score: Math.round(Math.min(100, Math.max(0, raw.score))),
    summary: raw.summary,
    weakestLineIndex: weakest,
    pattern: raw.pattern,
    lines,
  };
}
