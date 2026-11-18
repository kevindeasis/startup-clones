import { beforeEach, describe, expect, it } from "vitest";
import samples from "@/data/sample-applications.json";
import { isMock, mockReport, reviewAiSchema, structured } from "@/lib/llm";
import { reviewApplication } from "@/lib/review";
import type { Application } from "@/lib/types";

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("mock llm", () => {
  it("is mock without key and with LLM_MOCK=1", () => {
    expect(isMock()).toBe(true);
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.LLM_MOCK = "1";
    expect(isMock()).toBe(true);
    delete process.env.LLM_MOCK;
    expect(isMock()).toBe(false);
  });
  it("structured output validates against the zod schema and is deterministic", async () => {
    const app = (samples as unknown as Application[])[0];
    const a = await reviewApplication(app);
    const b = await reviewApplication(app);
    expect(a.summary).toBe(b.summary);
    const out = await structured({
      system: "s",
      prompt: "p",
      schema: reviewAiSchema,
      mock: () => ({ summary: "x", recommendation: "approve" as const, conditions: [], extraChecks: [] }),
    });
    expect(reviewAiSchema.safeParse(out).success).toBe(true);
  });
  it("review keeps rule statuses and report has Recommendation", async () => {
    const app = (samples as unknown as Application[])[0];
    const review = await reviewApplication(app);
    expect(review.checks.some((c) => c.status === "fail" && c.source === "rule")).toBe(true);
    expect(mockReport({ ...app, review })).toContain("Recommendation");
  });
});
