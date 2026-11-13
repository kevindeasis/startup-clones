import { describe, expect, it } from "vitest";
import { mockExtract, mockSynthesise } from "../src/lib/mock-pipeline";
import { InterviewExtraction, StudySynthesis } from "../src/lib/schemas";
import { transcript } from "./fixtures";

describe("mock extraction and synthesis", () => {
  const extraction = mockExtract(transcript, { role: "Account Executive" });

  it("produces an object that validates against InterviewExtraction", () => {
    expect(InterviewExtraction.safeParse(extraction).success).toBe(true);
    expect(extraction.steps.length).toBeGreaterThanOrEqual(3);
    expect(extraction.painPoints.length).toBeGreaterThanOrEqual(1);
  });

  it("produces a synthesis that validates against StudySynthesis with merged counts", () => {
    const s = mockSynthesise([
      { participant: { team: "Sales", site: "Vienna", role: "AE" }, extraction },
      { participant: { team: "Finance", site: "Munich", role: "CC" }, extraction },
    ]);
    expect(StudySynthesis.safeParse(s).success).toBe(true);
    expect(s.mergedSteps.length).toBe(extraction.steps.length);
    expect(s.mergedSteps.every((m) => m.mentionedBy === 2)).toBe(true);
    expect(s.painPoints[0].teams).toEqual(["Sales", "Finance"]);
  });
});
