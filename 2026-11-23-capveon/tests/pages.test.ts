import { describe, expect, it } from "vitest";
import { chunkPage, splitPages } from "../src/lib/pages";

describe("splitPages", () => {
  it("splits on --- page N --- markers", () => {
    const pages = splitPages("--- page 1 ---\nAlpha\n--- page 2 ---\nBeta\n--- page 3 ---\nGamma");
    expect(pages.map((p) => p.text)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(pages.map((p) => p.n)).toEqual([1, 2, 3]);
  });
  it("treats text before the first marker as page 1 (2-page upload)", () => {
    const pages = splitPages("Water main replacement project.\n--- page 2 ---\nSecond page.");
    expect(pages).toHaveLength(2);
    expect(pages[1].n).toBe(2);
  });
  it("splits on form feeds", () => {
    expect(splitPages("one\ftwo\fthree")).toHaveLength(3);
  });
  it("creates ~3000 character pseudo-pages when there are no markers", () => {
    const para = "x".repeat(900);
    const pages = splitPages([para, para, para, para, para, para, para].join("\n\n"));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.every((p) => p.text.length <= 3100)).toBe(true);
  });
  it("chunks pages for retrieval", () => {
    const chunks = chunkPage({ n: 4, text: `${"a ".repeat(300)}\n\n${"b ".repeat(300)}` }, 700);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.page === 4)).toBe(true);
  });
});
