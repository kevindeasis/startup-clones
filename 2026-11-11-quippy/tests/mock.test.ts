import { describe, expect, it } from "vitest";
import { SCENARIOS } from "@/lib/curriculum";
import { gradeLine, mockDrill, mockFeedback, mockPartnerLine, mockPartnerStream } from "@/lib/llm/mock";
import { PATTERNS } from "@/lib/schemas";

const opener = SCENARIOS[0];
const followup = SCENARIOS[1];

describe("mock partner", () => {
  it("cycles through per-scenario lines by turn index", () => {
    expect(mockPartnerLine("s1-opener", 0)).not.toBe(mockPartnerLine("s1-opener", 1));
    expect(mockPartnerLine("s1-opener", 0)).toBe(mockPartnerLine("s1-opener", 7));
    expect(mockPartnerLine("custom-xyz", 0).length).toBeGreaterThan(0);
  });
  it("streams word by word and reassembles to the line", async () => {
    const chunks: string[] = [];
    for await (const c of mockPartnerStream("s3-invite", 0, 0)) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join("")).toBe(mockPartnerLine("s3-invite", 0));
  });
});

describe("mock grader heuristics", () => {
  it("sorry backfires as over-apologising", () => {
    expect(gradeLine("Sorry to bother you", opener.type)).toMatchObject({ verdict: "backfired", pattern: "over-apologising" });
  });
  it("over 40 words backfires as too-long", () => {
    expect(gradeLine(Array(45).fill("word").join(" "), opener.type)).toMatchObject({ verdict: "backfired", pattern: "too-long" });
  });
  it("follow-up without a question is no-question-back", () => {
    expect(gradeLine("I love hiking too, did one last month", followup.type).pattern).toBe("no-question-back");
    expect(gradeLine("I love hiking too, where do you usually go?", followup.type).verdict).toBe("landed");
  });
  it("feedback has one entry per user line and a valid pattern", () => {
    const messages = [
      { role: "partner" as const, text: "Hi", index: 0 },
      { role: "user" as const, text: "Sorry, hi there", index: 1 },
      { role: "partner" as const, text: "Hm", index: 2 },
      { role: "user" as const, text: "Nice weather today, how is your morning going?", index: 3 },
    ];
    const fb = mockFeedback(opener, messages);
    expect(fb.lines.map((l) => l.index)).toEqual([1, 3]);
    expect(PATTERNS).toContain(fb.pattern);
    expect(fb.pattern).toBe("over-apologising");
    expect(fb.weakestLineIndex).toBe(1);
    expect(fb.lines[0].stronger).toBeTruthy();
    expect(fb.lines[1].verdict).toBe("landed");
    expect(fb.score).toBeGreaterThanOrEqual(0);
    expect(fb.score).toBeLessThanOrEqual(100);
  });
  it("drill grading uses the same heuristics", () => {
    expect(mockDrill(opener, "Hi, I'm Sam. What is your name?", "Sorry hi").verdict).toBe("landed");
    expect(mockDrill(opener, "sorry again", "Sorry hi").verdict).toBe("backfired");
  });
});
