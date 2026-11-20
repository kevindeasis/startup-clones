import { describe, expect, it } from "vitest";
import { createNarrator } from "@/lib/segmenter/cast";
import { applyChunkResult, findCharacter } from "@/lib/segmenter/merge";
import type { Character, Segment } from "@/lib/types";
import { chunkResultSchema } from "@/lib/segmenter/schema";
import { resolveMode } from "@/lib/llm-mode";

describe("applyChunkResult (schema -> characterId mapping)", () => {
  it("maps speakers to ids and merges aliases case-insensitively", () => {
    const cast: Character[] = [createNarrator()];
    const segments: Segment[] = [];
    applyChunkResult(cast, segments, {
      characters: [{ name: "Queen of Hearts", aliases: ["The Queen"], genderHint: "female", ageHint: "adult", personality: "imperious" }],
      segments: [
        { kind: "narration", speaker: "Narrator", text: "She turned." },
        { kind: "dialogue", speaker: "the queen", text: "“Off with his head!”" },
      ],
    }, 0);
    applyChunkResult(cast, segments, {
      characters: [{ name: "THE QUEEN", aliases: ["Her Majesty"], genderHint: "unknown", ageHint: "unknown", personality: "" }],
      segments: [
        { kind: "dialogue", speaker: "QUEEN OF HEARTS", text: "“Silence!”" },
        { kind: "dialogue", speaker: "Her Majesty", text: "“Now!”" },
        { kind: "dialogue", speaker: "Alice", text: "“Oh.”" },
      ],
    }, 1);
    expect(cast.filter((c) => !c.isNarrator).map((c) => c.name)).toEqual(["Queen of Hearts", "Alice"]);
    const queen = findCharacter(cast, "queen of hearts")!;
    expect(queen.aliases.map((a) => a.toLowerCase())).toEqual(expect.arrayContaining(["the queen", "her majesty"]));
    expect(queen.aliases.filter((a) => a.toLowerCase() === "the queen")).toHaveLength(1);
    expect(segments.map((s) => s.characterId)).toEqual(["narrator", queen.id, queen.id, queen.id, findCharacter(cast, "Alice")!.id]);
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(segments[0].kind).toBe("narration");
  });

  it("validates results with the zod schema", () => {
    expect(chunkResultSchema.safeParse({ segments: [{ kind: "dialogue", speaker: "A", text: "x" }], characters: [] }).success).toBe(true);
    expect(chunkResultSchema.safeParse({ segments: [{ kind: "shout", speaker: "A", text: "x" }], characters: [] }).success).toBe(false);
  });
});

describe("resolveMode", () => {
  it("auto picks live only with a key", () => {
    expect(resolveMode({})).toBe("mock");
    expect(resolveMode({ ANTHROPIC_API_KEY: "k" })).toBe("live");
    expect(resolveMode({ ANTHROPIC_API_KEY: "k", LLM_MODE: "mock" })).toBe("mock");
    expect(resolveMode({ LLM_MODE: "live" })).toBe("live");
  });
});
