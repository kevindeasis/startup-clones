import { getAgency, getDocument, getProfile, getSignal, listDocuments, listSignals } from "./data";
import { getLLM } from "./llm";
import { HttpError } from "./pipeline";
import { buildTaskPlan, effectiveDueDate } from "./planner";
import { getById, readCollection, updateCollection, upsert } from "./store";
import type { Note, Pursuit, Signal, Task } from "./types";
import { addDays, newId, todayIso } from "./util";

export async function createPursuit(input: { signalId?: string; documentId?: string }): Promise<{ pursuit: Pursuit; created: boolean }> {
  const profile = await getProfile();
  let signal: Signal | undefined;
  let documentId = input.documentId;
  if (input.signalId) {
    signal = await getSignal(input.signalId);
    if (!signal) throw new HttpError(404, "Signal not found");
    if (!documentId) {
      for (const src of signal.sources) {
        const d = await getDocument(src.documentId);
        if (d?.kind === "solicitation") documentId = d.id;
      }
    }
  }
  const doc = documentId ? await getDocument(documentId) : undefined;
  if (documentId && !doc) throw new HttpError(404, "Document not found");
  if (doc && doc.kind !== "solicitation") throw new HttpError(400, "Pursuits can be started from solicitation documents");
  if (!signal && doc) signal = (await listSignals()).find((s) => s.sources.some((x) => x.documentId === doc.id));

  const pursuits = await readCollection<Pursuit>("pursuits");
  const existing = pursuits.find((p) => (signal && p.signalId === signal.id) || (doc && p.documentId === doc.id));
  if (existing) return { pursuit: existing, created: false };

  const agencyId = signal?.agencyId ?? doc!.agencyId;
  const agency = await getAgency(agencyId);
  if (!agency) throw new HttpError(400, "Agency missing");
  const stage = signal?.stage ?? "solicitation";
  const id = newId("pur");
  const kf = doc?.keyFields;
  const dueDate = kf?.bidDue?.iso;
  const today = todayIso();
  const tasks: Task[] = buildTaskPlan({
    pursuitId: id,
    dueDate,
    stage,
    team: profile.team,
    today,
    preBidDate: kf?.preBid?.iso,
    questionsDate: kf?.questionsDeadline?.iso,
  });
  if (doc?.requirements?.length) {
    const due = effectiveDueDate(dueDate, stage, today);
    const suggestions = await getLLM().suggestTasks({ pursuitTitle: signal?.projectTitle ?? doc.title, requirements: doc.requirements });
    const owner = profile.team.find((m) => /estimat|engineer/i.test(m.role))?.name ?? profile.team[0]?.name ?? "Unassigned";
    for (const s of suggestions.slice(0, 3)) {
      tasks.push({ id: newId("task"), pursuitId: id, title: s.title, owner, dueDate: addDays(due, -9), done: false, source: "llm", page: s.page });
    }
  }
  const pursuit: Pursuit = {
    id,
    signalId: signal?.id,
    documentId: doc?.id,
    agencyId,
    title: signal?.projectTitle ?? doc!.title,
    stage,
    fitScore: signal?.fitScore ?? 0,
    dueDate,
    status: "active",
    taskIds: tasks.map((t) => t.id),
    noteIds: [],
    events: [{ id: newId("ev"), at: new Date().toISOString(), type: "created", summary: `Pursuit started (${stage}).`, documentId: doc?.id }],
    createdAt: new Date().toISOString(),
  };
  await updateCollection<Task>("tasks", (all) => {
    all.push(...tasks);
  });
  await upsert("pursuits", pursuit);
  if (signal) {
    await updateCollection<Signal>("signals", (all) => {
      const s = all.find((x) => x.id === signal!.id);
      if (s) s.pursuitId = id;
    });
  }
  return { pursuit, created: true };
}

export async function getPursuitDetail(id: string) {
  const pursuit = await getById<Pursuit>("pursuits", id);
  if (!pursuit) return undefined;
  const [tasks, notes, agency] = await Promise.all([
    readCollection<Task>("tasks"),
    readCollection<Note>("notes"),
    getAgency(pursuit.agencyId),
  ]);
  return {
    pursuit,
    agency,
    tasks: tasks.filter((t) => t.pursuitId === id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    notes: notes.filter((n) => n.pursuitId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function draftForPursuit(id: string): Promise<Note> {
  const pursuit = await getById<Pursuit>("pursuits", id);
  if (!pursuit) throw new HttpError(404, "Pursuit not found");
  const [profile, agency] = [await getProfile(), await getAgency(pursuit.agencyId)];
  const docs = await listDocuments();
  const doc = pursuit.documentId ? docs.find((d) => d.id === pursuit.documentId) : undefined;
  let text = await getLLM().draftLetter({
    profile,
    agencyName: agency?.name ?? "the Agency",
    pursuitTitle: pursuit.title,
    requirements: doc?.requirements ?? [],
  });
  const words = text.split(/\s+/);
  if (words.length > 280) text = words.slice(0, 280).join(" ");
  const note: Note = { id: newId("note"), pursuitId: id, kind: "draft", text, createdAt: new Date().toISOString() };
  await updateCollection<Note>("notes", (all) => {
    all.push(note);
  });
  await updateCollection<Pursuit>("pursuits", (all) => {
    all.find((p) => p.id === id)?.noteIds.push(note.id);
  });
  return note;
}

export async function setTaskDone(id: string, done: boolean): Promise<Task | undefined> {
  return updateCollection<Task, Task | undefined>("tasks", (all) => {
    const t = all.find((x) => x.id === id);
    if (t) t.done = done;
    return t ? { ...t } : undefined;
  });
}
