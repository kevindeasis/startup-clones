import type { Action, DB, Note, Project, Task } from "./types";
import { mutate, newId, readDb } from "./store";
import { planKickoff } from "./llm";
import { playSteps } from "./mock";
import { addDays, today } from "./util";

export async function createKickoffProject(accountId: string, transcript: string, opts: { at?: string; sourceTitle?: string } = {}) {
  const account = readDb().accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("account not found");
  const at = opts.at ?? today();
  const plan = await planKickoff(transcript, account, at);
  return mutate((db) => {
    const callNote: Note = {
      id: newId("note"), accountId, at, kind: "call",
      title: opts.sourceTitle ?? "Kickoff call", body: transcript,
    };
    const recapNote: Note = {
      id: newId("note"), accountId, at, kind: "slack-draft", title: "Kickoff recap (Slack draft)", body: plan.recap,
    };
    const project: Project = {
      id: newId("proj"), accountId, kind: "onboarding", title: `Onboarding — ${account.name}`, status: "active",
      createdAt: new Date().toISOString(), goals: plan.goals, stakeholders: plan.stakeholders, risks: plan.risks,
      recap: plan.recap, sourceNoteId: callNote.id,
    };
    const tasks: Task[] = plan.tasks.map((t) => ({
      id: newId("task"), projectId: project.id, accountId, title: t.title, ownerSide: t.ownerSide,
      ...(t.ownerName ? { ownerName: t.ownerName } : {}), dueAt: addDays(at, Math.max(0, Math.round(t.dueInDays))),
      isBlocker: t.isBlocker, done: false,
    }));
    db.notes.push(callNote, recapNote);
    db.projects.push(project);
    db.tasks.push(...tasks);
    return { project, tasks, recap: plan.recap, blockers: plan.blockers, degraded: plan.degraded };
  });
}

/** Accept: create the recommended project with template tasks and mark the action accepted. */
export function acceptAction(db: DB, action: Action): Project {
  const account = db.accounts.find((a) => a.id === action.accountId)!;
  const kind = action.type === "expansion" ? "expansion" : "save_play";
  const project: Project = {
    id: newId("proj"), accountId: account.id, kind,
    title: `${action.title} — ${account.name}`, status: "active", createdAt: new Date().toISOString(),
    goals: [action.title], risks: [],
    stakeholders: [
      { name: account.champion.name, role: account.champion.title, side: "customer" },
      { name: account.owner, role: "Account owner", side: "vendor" },
    ],
  };
  const now = today();
  playSteps(action.play).forEach((title, i) => {
    db.tasks.push({
      id: newId("task"), projectId: project.id, accountId: account.id, title, ownerSide: "vendor",
      ownerName: account.owner, dueAt: addDays(now, 3 * (i + 1)), isBlocker: false, done: false,
    });
  });
  db.projects.push(project);
  action.status = "accepted";
  action.projectId = project.id;
  return project;
}
