import { describe, expect, it } from "vitest";
import { chunkText, countWords, normalizeText, splitParagraphs } from "@/lib/segmenter/chunk";

function makeText(paragraphs: number, wordsEach: number) {
  return Array.from({ length: paragraphs }, (_, p) =>
    Array.from({ length: wordsEach }, (_, w) => `w${p}x${w}`).join(" "),
  ).join("\n\n");
}

describe("chunkText", () => {
  it("never splits a paragraph and covers all text in order", () => {
    const text = normalizeText(makeText(40, 70));
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    const paragraphs = splitParagraphs(text);
    const rejoined = chunks.flatMap((c) => splitParagraphs(c.text));
    expect(rejoined).toEqual(paragraphs);
    for (const c of chunks) {
      expect(countWords(c.text)).toBeLessThanOrEqual(1200 + 70);
      expect(paragraphs[c.startParagraph]).toBe(splitParagraphs(c.text)[0]);
    }
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("keeps an oversized paragraph whole", () => {
    const big = makeText(1, 3000);
    const chunks = chunkText(`short one\n\n${big}\n\nshort two`);
    expect(chunks.some((c) => c.text.includes(big))).toBe(true);
    expect(chunks.map((c) => c.text).join("\n\n")).toBe(`short one\n\n${big}\n\nshort two`);
  });

  it("treats hard-wrapped lines as paragraphs", () => {
    expect(splitParagraphs(normalizeText("a b\nc d\ne f"))).toEqual(["a b", "c d", "e f"]);
  });
});
