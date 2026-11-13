import { describe, expect, it } from "vitest";
import { buildContextMarkdown } from "../src/lib/context";
import { buildMermaid } from "../src/lib/mermaid";
import { synthesis } from "./fixtures";

describe("context.md", () => {
  it("includes the mermaid block, steps and provenance", () => {
    const study = { id: "1", title: "Quotes", topic: "How are quotes made?", goal: "g", teams: [], createdAt: "" };
    const md = buildContextMarkdown(study, synthesis, buildMermaid(synthesis), 3);
    expect(md).toContain("```mermaid\nflowchart TD");
    expect(md).toContain("## Steps");
    expect(md).toContain("Interviews synthesised: 3");
  });
});
