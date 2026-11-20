import { describe, expect, it } from "vitest";
import { assignVoice, createNarrator } from "@/lib/segmenter/cast";
import type { AgeHint, Character, GenderHint } from "@/lib/types";

function build(hints: Array<[GenderHint, AgeHint]>): Character[] {
  const cast = [createNarrator()];
  hints.forEach(([g, a], i) => {
    const { voice, color } = assignVoice(cast, g, a);
    cast.push({ id: `c${i + 1}`, name: `C${i + 1}`, aliases: [], isNarrator: false, genderHint: g, ageHint: a, personality: "", voice, color });
  });
  return cast;
}

const HINTS: Array<[GenderHint, AgeHint]> = [
  ["female", "adult"], ["female", "adult"], ["female", "child"], ["male", "adult"], ["male", "elder"],
  ["male", "adult"], ["unknown", "unknown"], ["unknown", "unknown"], ["female", "young"], ["male", "young"],
  ["female", "elder"], ["male", "child"], ["unknown", "child"], ["female", "adult"],
];

describe("cast assignment", () => {
  it("yields unique voice profiles for >= 8 characters (and 14)", () => {
    for (const n of [8, 14]) {
      const cast = build(HINTS.slice(0, n));
      const keys = cast.map((c) => `${c.voice.slot}|${c.voice.pitch}|${c.voice.rate}`);
      expect(new Set(keys).size).toBe(cast.length);
    }
  });

  it("is deterministic", () => {
    expect(build(HINTS).map((c) => c.voice)).toEqual(build(HINTS).map((c) => c.voice));
  });

  it("applies age/gender tendencies and keeps the narrator at slot 0", () => {
    const cast = build([["female", "child"], ["male", "elder"]]);
    expect(cast[0].voice).toEqual({ slot: 0, pitch: 1, rate: 1 });
    expect(cast[1].voice.pitch).toBeGreaterThanOrEqual(1.3);
    expect(cast[1].voice.slot % 2).toBe(1);
    expect(cast[2].voice.pitch).toBeLessThanOrEqual(0.85);
    expect(cast[2].voice.rate).toBeLessThan(1);
  });

  it("assigns distinct colours from the palette", () => {
    const cast = build(HINTS.slice(0, 12));
    expect(new Set(cast.filter((c) => !c.isNarrator).map((c) => c.color)).size).toBe(12);
  });
});
