import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { segmentChunkLive } from "@/lib/segmenter/llm";
import { createNarrator } from "@/lib/segmenter/cast";

const chunk = `"Hello," said Alice.\n\n"Hi there," said the Hatter, grinning widely at her.`;
const payload = {
  segments: [
    { kind: "dialogue", speaker: "Alice", text: `"Hello,"` },
    { kind: "narration", speaker: "Narrator", text: "said Alice." },
    { kind: "dialogue", speaker: "Hatter", text: `"Hi there,"` },
    { kind: "narration", speaker: "Narrator", text: "said the Hatter, grinning widely at her." },
  ],
  characters: [{ name: "Alice", aliases: [], genderHint: "female", ageHint: "child", personality: "polite" }],
};

function model(obj: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(obj) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
      warnings: [],
    }),
  });
}

describe("live path (mocked model)", () => {
  it("parses structured output through generateText + Output.object", async () => {
    const r = await segmentChunkLive(chunk, [createNarrator()], "claude-opus-5-5", model(payload));
    expect(r.segments).toHaveLength(4);
    expect(r.characters[0].name).toBe("Alice");
  });

  it("rejects output that drops text", async () => {
    const short = { ...payload, segments: payload.segments.slice(0, 1) };
    await expect(segmentChunkLive(chunk, [createNarrator()], "claude-opus-5-5", model(short))).rejects.toThrow();
  });

  it("rejects schema violations", async () => {
    await expect(segmentChunkLive(chunk, [createNarrator()], "m", model({ segments: [{ kind: "x" }], characters: [] }))).rejects.toThrow();
  });
});
