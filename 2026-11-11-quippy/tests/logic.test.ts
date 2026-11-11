import { describe, expect, it } from "vitest";
import { SCENARIOS, UNITS } from "@/lib/curriculum";
import { nextScenarioId, normalizeFeedback, patternCounts, scenarioStates, streakDays, topPattern } from "@/lib/logic";
import type { Feedback } from "@/lib/schemas";

describe("curriculum unlock rules", () => {
  it("only the first lesson is unlocked at the start", () => {
    const st = scenarioStates(UNITS, SCENARIOS, []);
    expect(st["s1-opener"]).toBe("unlocked");
    expect(st["s2-followup"]).toBe("locked");
    expect(st["s3-invite"]).toBe("locked");
  });
  it("completing lesson 1 unlocks lesson 2 but not the next unit", () => {
    const st = scenarioStates(UNITS, SCENARIOS, ["s1-opener"]);
    expect(st["s1-opener"]).toBe("completed");
    expect(st["s2-followup"]).toBe("unlocked");
    expect(st["s3-invite"]).toBe("locked");
  });
  it("completing a whole unit unlocks the next unit's first lesson", () => {
    const st = scenarioStates(UNITS, SCENARIOS, ["s1-opener", "s2-followup"]);
    expect(st["s3-invite"]).toBe("unlocked");
    expect(st["s4-yes"]).toBe("locked");
    expect(nextScenarioId(UNITS, SCENARIOS, st)).toBe("s3-invite");
  });
  it("custom scenarios are always unlocked", () => {
    const custom = { ...SCENARIOS[0], id: "c1", unitId: "custom", custom: true };
    expect(scenarioStates(UNITS, [...SCENARIOS, custom], [])["c1"]).toBe("unlocked");
  });
});

describe("streak", () => {
  it("is 0 with no sessions and 1 for today only", () => {
    expect(streakDays([], "2026-11-11")).toBe(0);
    expect(streakDays(["2026-11-11"], "2026-11-11")).toBe(1);
  });
  it("counts consecutive days, across a month boundary", () => {
    expect(streakDays(["2026-10-31", "2026-11-01", "2026-11-02"], "2026-11-02")).toBe(3);
  });
  it("survives until a full day is missed, then resets", () => {
    expect(streakDays(["2026-11-09", "2026-11-10"], "2026-11-11")).toBe(2);
    expect(streakDays(["2026-11-08", "2026-11-09"], "2026-11-11")).toBe(0);
  });
  it("a gap breaks the streak", () => {
    expect(streakDays(["2026-11-07", "2026-11-10", "2026-11-11"], "2026-11-11")).toBe(2);
  });
});

describe("pattern aggregation", () => {
  const fb = (pattern: Feedback["pattern"]): Feedback => ({ score: 50, summary: "", weakestLineIndex: 1, pattern, lines: [] });
  it("counts and picks the top non-fine pattern", () => {
    const counts = patternCounts([fb("fine"), fb("fine"), fb("fine"), fb("hedging"), fb("hedging"), fb("too-long")]);
    expect(counts).toEqual({ fine: 3, hedging: 2, "too-long": 1 });
    expect(topPattern(counts)).toBe("hedging");
  });
  it("returns null when only fine", () => {
    expect(topPattern({ fine: 4 })).toBeNull();
  });
});

describe("normalizeFeedback", () => {
  const raw = { score: 140, summary: "s", weakest_line_index: 9, pattern: "hedging" as const, lines: [
    { index: 1, verdict: "landed" as const, reason: "r", stronger: "ignored" },
    { index: 3, verdict: "okay" as const, reason: "r", stronger: "better" },
  ] };
  it("requires one entry per user line, clamps score, repairs weakest index", () => {
    const fb = normalizeFeedback(raw, [1, 3])!;
    expect(fb.score).toBe(100);
    expect(fb.weakestLineIndex).toBe(3);
    expect(fb.lines[0].stronger).toBeUndefined();
    expect(normalizeFeedback(raw, [1, 3, 5])).toBeNull();
  });
});
