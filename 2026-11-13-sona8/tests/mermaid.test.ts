import { describe, expect, it } from "vitest";
import { buildMermaid, sanitizeLabel } from "../src/lib/mermaid";
import { synthesis } from "./fixtures";

describe("mermaid", () => {
  it("strips quotes, brackets and semicolons from labels", () => {
    const label = sanitizeLabel('a "b" [c] (d) {e}; f');
    expect(label).not.toMatch(/["\[\](){};]/);
  });

  it("truncates long labels", () => {
    expect(sanitizeLabel("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it("styles manual steps with the manual class", () => {
    const out = buildMermaid(synthesis);
    expect(out).toContain("classDef manual");
    expect(out.split("\n").filter((l) => l.includes(":::manual"))).toHaveLength(1);
  });

  it("renders exceptions as diamond nodes and drops edges to unknown ids", () => {
    const out = buildMermaid(synthesis);
    expect(out).toMatch(/X0_0\{"Customer is new\?"\}/);
    expect(out).not.toContain("ghost");
    expect(out.startsWith("flowchart TD")).toBe(true);
  });
});
