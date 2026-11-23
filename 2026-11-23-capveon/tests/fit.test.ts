import { describe, expect, it } from "vitest";
import { categoryPoints, fitBand, scoreFit, valuePoints } from "../src/lib/fit";
import { profile } from "./fixtures";

describe("fit scorer", () => {
  it("scores exact category 40, adjacent 15, none 0", () => {
    expect(categoryPoints(profile, "wastewater")).toBe(40);
    expect(categoryPoints({ categories: ["water"] }, "stormwater")).toBe(15);
    expect(categoryPoints(profile, "roads_bridges")).toBe(0);
  });
  it("scores the value band 15 inside, 7 unknown, 0 outside", () => {
    expect(valuePoints(profile, 1_850_000)).toBe(15);
    expect(valuePoints(profile, undefined)).toBe(7);
    expect(valuePoints(profile, 50_000_000)).toBe(0);
  });
  it("gives a perfect score to a matching lift-station project", () => {
    const r = scoreFit(profile, {
      category: "wastewater",
      title: "Mill Creek Lift Station Rehabilitation",
      summary: "Replace pump, check valves, VFD panel with SCADA and wet well rehab",
      evidence: "force main",
      estimatedValue: 1_850_000,
      agencyRegion: "Brightwater County, Cascadia",
    });
    expect(r.score).toBe(100);
  });
  it("puts a statewide road resurfacing project in the weak band", () => {
    const r = scoreFit(profile, {
      category: "roads_bridges",
      title: "Route 9 Resurfacing Phase 2",
      summary: "asphalt pavement",
      evidence: "cold milling",
      estimatedValue: 4_200_000,
      agencyRegion: "Cascadia (statewide)",
    });
    expect(r.breakdown).toEqual({ category: 0, keywords: 0, region: 0, value: 15 });
    expect(fitBand(r.score)).toBe("weak");
  });
  it("bands at 70 / 40", () => {
    expect(fitBand(70)).toBe("strong");
    expect(fitBand(69)).toBe("possible");
    expect(fitBand(40)).toBe("possible");
    expect(fitBand(39)).toBe("weak");
  });
});
