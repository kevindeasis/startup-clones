import { describe, expect, it } from "vitest";
import { buildPools, resolveVoice, splitForSpeech } from "@/lib/voices";

const V = [
  { name: "Microsoft David - English", lang: "en-US", default: true },
  { name: "Microsoft Zira - English", lang: "en-US" },
  { name: "Google UK English Female", lang: "en-GB" },
  { name: "Google UK English Male", lang: "en-GB" },
  { name: "Thomas", lang: "fr-FR" },
];

describe("voices", () => {
  it("filters by language and splits by gender keyword", () => {
    const p = buildPools(V, "en");
    expect(p.all).toHaveLength(4);
    expect(p.female.map((v) => v.name)).toEqual(["Microsoft Zira - English", "Google UK English Female"]);
    expect(p.male.map((v) => v.name)).toEqual(["Microsoft David - English", "Google UK English Male"]);
  });
  it("resolves slots and preferredVoiceName", () => {
    const p = buildPools(V, "en");
    expect(resolveVoice({ slot: 0, pitch: 1, rate: 1 }, p)?.name).toContain("David");
    expect(resolveVoice({ slot: 1, pitch: 1, rate: 1 }, p)?.name).toContain("Zira");
    expect(resolveVoice({ slot: 3, pitch: 1, rate: 1 }, p)?.name).toContain("Female");
    expect(resolveVoice({ slot: 2, pitch: 1, rate: 1 }, p)?.name).toContain("David");
    expect(resolveVoice({ slot: 1, pitch: 1, rate: 1, preferredVoiceName: "Google UK English Male" }, p)?.name).toBe("Google UK English Male");
    expect(resolveVoice({ slot: 1, pitch: 1, rate: 1 }, buildPools([], "en"))).toBeUndefined();
  });
  it("splits long text into short utterances", () => {
    const text = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i}.`).join(" ");
    const parts = splitForSpeech(text, 120);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });
});
