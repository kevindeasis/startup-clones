import { beforeAll, describe, expect, it } from "vitest";
import { withTempDb } from "./helpers";

withTempDb();

describe("mock analyst", () => {
  let runReadOnlySql: typeof import("../src/lib/sql-guard").runReadOnlySql;
  let planMock: typeof import("../src/lib/mock-analyst").planMock;

  beforeAll(async () => {
    ({ runReadOnlySql } = await import("../src/lib/sql-guard"));
    ({ planMock } = await import("../src/lib/mock-analyst"));
    const { seedDemo } = await import("../src/lib/seed");
    seedDemo();
  });

  it.each([
    "What were my top 5 pages last week?",
    "Which referrers brought the most signups in the last 30 days?",
    "How many visitors did I get yesterday?",
    "tell me a joke",
  ])("plans guarded SQL that executes: %s", (question) => {
    const plan = planMock(question);
    const res = runReadOnlySql("demo", plan.sql);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (res.ok) expect(res.columns.length).toBeGreaterThan(0);
  });

  it("honours top N and falls back for unknown questions", () => {
    const top = runReadOnlySql("demo", planMock("What were my top 5 pages last week?").sql);
    expect(top.ok && top.rows.length).toBe(5);
    expect(planMock("tell me a joke").fellBack).toBe(true);
  });

  it("the read-only connection refuses writes even if the guard were bypassed", async () => {
    const { getReadDb } = await import("../src/lib/db");
    expect(() => getReadDb().prepare("DELETE FROM events").run()).toThrow();
  });
});
