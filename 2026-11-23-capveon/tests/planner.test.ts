import { describe, expect, it } from "vitest";
import { applyDueDateChange, buildTaskPlan, effectiveDueDate } from "../src/lib/planner";
import { pickDueDateChange } from "../src/lib/pipeline";
import { profile } from "./fixtures";

const opts = { pursuitId: "p1", stage: "solicitation" as const, team: profile.team, today: "2026-11-23" };

describe("pursuit planner", () => {
  it("builds the 8 template tasks backward from the due date, none after it", () => {
    const tasks = buildTaskPlan({ ...opts, dueDate: "2026-12-18" });
    expect(tasks.map((t) => t.title)).toEqual([
      "Confirm fit & go/no-go",
      "Register on portal / request plans",
      "Attend pre-bid",
      "Submit questions",
      "Pricing & subs",
      "Bond & insurance certs",
      "Assemble submission",
      "Submit",
    ]);
    expect(tasks.every((t) => t.dueDate <= "2026-12-18")).toBe(true);
    expect(tasks[7].dueDate).toBe("2026-12-18");
    expect(tasks[0].dueDate).toBe("2026-11-27");
  });
  it("uses explicit pre-bid and questions dates and anchors them", () => {
    const tasks = buildTaskPlan({ ...opts, dueDate: "2026-12-18", preBidDate: "2026-12-02", questionsDate: "2026-12-09" });
    expect(tasks[2]).toMatchObject({ dueDate: "2026-12-02", anchored: true });
    expect(tasks[3]).toMatchObject({ dueDate: "2026-12-09", anchored: true });
  });
  it("falls back to stage horizons when there is no due date", () => {
    expect(effectiveDueDate(undefined, "solicitation", "2026-11-23")).toBe("2026-12-14");
    expect(effectiveDueDate(undefined, "design", "2026-11-23")).toBe("2027-02-21");
    expect(effectiveDueDate(undefined, "discussion", "2026-11-23")).toBe("2028-05-16");
  });
  it("assigns owners from the team", () => {
    const tasks = buildTaskPlan({ ...opts, dueDate: "2026-12-18" });
    expect(tasks[0].owner).toBe("Dana");
    expect(tasks[4].owner).toBe("Priya");
  });
});

describe("addendum due-date application", () => {
  it("shifts open, unanchored tasks by the delta and leaves done/anchored tasks alone", () => {
    const tasks = buildTaskPlan({ ...opts, dueDate: "2026-12-18", preBidDate: "2026-12-02" });
    tasks[0].done = true;
    const shifted = applyDueDateChange(tasks, "2026-12-18", "2027-01-08");
    expect(shifted[0].dueDate).toBe(tasks[0].dueDate); // done
    expect(shifted[2].dueDate).toBe("2026-12-02"); // anchored
    expect(shifted[7].dueDate).toBe("2027-01-08");
    expect(shifted[4].dueDate).toBe("2027-01-01");
  });
  it("picks the last ISO due_date change", () => {
    expect(
      pickDueDateChange([
        { field: "spec", summary: "", page: 1, quote: "" },
        { field: "due_date", after: "2027-01-08", summary: "", page: 1, quote: "" },
      ]),
    ).toBe("2027-01-08");
    expect(pickDueDateChange([{ field: "due_date", after: "next week", summary: "", page: 1, quote: "" }])).toBeUndefined();
  });
});
