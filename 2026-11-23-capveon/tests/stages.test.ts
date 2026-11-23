import { describe, expect, it } from "vitest";
import { compareSignals, findMatchingSignal, laterStage, mergeSignal, stageRank, titlesMatch } from "../src/lib/stages";
import type { Signal } from "../src/lib/types";

const base = {
  stage: "planned" as const,
  category: "wastewater" as const,
  summary: "s",
  confidence: 0.7,
  sources: [{ documentId: "d1", page: 2, quote: "q1" }],
  estimatedValue: 1_500_000,
  valueText: "$1.5M",
  timing: "FY2027",
};

describe("stages and merge", () => {
  it("orders stages discussion < ... < awarded", () => {
    expect(stageRank("discussion")).toBeLessThan(stageRank("planned"));
    expect(laterStage("design", "budgeted")).toBe("design");
    expect(laterStage("solicitation", "awarded")).toBe("awarded");
  });
  it("matches near-identical titles but not different projects", () => {
    expect(titlesMatch("Mill Creek Lift Station Rehabilitation", "Mill Creek Lift Station Rehab Project")).toBe(true);
    expect(titlesMatch("Mill Creek Lift Station Rehabilitation", "Harbor Street Lift Station Replacement")).toBe(false);
  });
  it("finds a match only within the same agency", () => {
    const existing = [{ agencyId: "a1", projectTitle: "County Road 12 Resurfacing Program" }];
    expect(findMatchingSignal(existing, "a1", "County Road 12 Resurfacing")).toBeDefined();
    expect(findMatchingSignal(existing, "a2", "County Road 12 Resurfacing")).toBeUndefined();
  });
  it("keeps the later stage, takes the newer value and appends the source", () => {
    const merged = mergeSignal(base, {
      ...base,
      stage: "solicitation",
      estimatedValue: 1_850_000,
      valueText: "$1.85M",
      sources: [{ documentId: "d2", page: 1, quote: "q2" }],
    });
    expect(merged.stage).toBe("solicitation");
    expect(merged.estimatedValue).toBe(1_850_000);
    expect(merged.sources).toHaveLength(2);
  });
  it("does not downgrade the stage or overwrite the value from an earlier-stage source", () => {
    const merged = mergeSignal({ ...base, stage: "design" }, { ...base, stage: "discussion", estimatedValue: 999 });
    expect(merged.stage).toBe("design");
    expect(merged.estimatedValue).toBe(1_500_000);
  });
  it("sorts by fit desc then later stage first", () => {
    const a = { fitScore: 70, stage: "planned" } as Signal;
    const b = { fitScore: 70, stage: "solicitation" } as Signal;
    const c = { fitScore: 90, stage: "discussion" } as Signal;
    expect([a, b, c].sort(compareSignals)).toEqual([c, b, a]);
  });
});
