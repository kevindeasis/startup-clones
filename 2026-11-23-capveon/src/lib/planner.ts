import type { Pursuit, Stage, Task, TeamMember } from "./types";
import { addDays, diffDays, newId } from "./util";

export const STAGE_HORIZON_DAYS: Record<Stage, number> = {
  solicitation: 21,
  design: 90,
  budgeted: 180,
  planned: 365,
  discussion: 540,
  awarded: 0,
};

export interface TemplateTask {
  title: string;
  /** days before the due date */
  offset: number;
  ownerRole: RegExp;
  explicit?: "preBid" | "questions";
}

export const TASK_TEMPLATE: TemplateTask[] = [
  { title: "Confirm fit & go/no-go", offset: 21, ownerRole: /sales|lead|manager/i },
  { title: "Register on portal / request plans", offset: 20, ownerRole: /admin|contract/i },
  { title: "Attend pre-bid", offset: 16, ownerRole: /engineer/i, explicit: "preBid" },
  { title: "Submit questions", offset: 11, ownerRole: /engineer/i, explicit: "questions" },
  { title: "Pricing & subs", offset: 7, ownerRole: /estimat/i },
  { title: "Bond & insurance certs", offset: 5, ownerRole: /admin|finance|contract/i },
  { title: "Assemble submission", offset: 2, ownerRole: /admin/i },
  { title: "Submit", offset: 0, ownerRole: /sales|lead|admin/i },
];

export function effectiveDueDate(dueDate: string | undefined, stage: Stage, today: string): string {
  return dueDate ?? addDays(today, STAGE_HORIZON_DAYS[stage] || 30);
}

function pickOwner(team: TeamMember[], role: RegExp, i: number): string {
  if (!team.length) return "Unassigned";
  return (team.find((m) => role.test(m.role)) ?? team[i % team.length]).name;
}

/**
 * Backward-scheduled task plan. All dates are <= the due date. Explicit pre-bid / questions
 * dates (when known and not after the due date) override the offset and are marked anchored.
 */
export function buildTaskPlan(opts: {
  pursuitId: string;
  dueDate?: string;
  stage: Stage;
  team: TeamMember[];
  today: string;
  preBidDate?: string;
  questionsDate?: string;
}): Task[] {
  const due = effectiveDueDate(opts.dueDate, opts.stage, opts.today);
  return TASK_TEMPLATE.map((t, i) => {
    let date = addDays(due, -t.offset);
    let anchored = false;
    const explicit = t.explicit === "preBid" ? opts.preBidDate : t.explicit === "questions" ? opts.questionsDate : undefined;
    if (explicit && explicit <= due) {
      date = explicit;
      anchored = true;
    }
    return {
      id: newId("task"),
      pursuitId: opts.pursuitId,
      title: t.title,
      owner: pickOwner(opts.team, t.ownerRole, i),
      dueDate: date,
      done: false,
      source: "template" as const,
      anchored,
    };
  });
}

/** Shift every not-done, non-anchored task by the delta between the old and new due date. */
export function applyDueDateChange<T extends Pick<Task, "done" | "dueDate" | "anchored">>(
  tasks: T[],
  oldDue: string,
  newDue: string,
): T[] {
  const delta = diffDays(oldDue, newDue);
  return tasks.map((t) => (t.done || t.anchored ? t : { ...t, dueDate: addDays(t.dueDate, delta) }));
}

export function nextOpenTask(tasks: Task[]): Task | undefined {
  return tasks.filter((t) => !t.done).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

export type PursuitLike = Pick<Pursuit, "dueDate">;
