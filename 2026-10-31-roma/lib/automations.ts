import cron, { type ScheduledTask } from "node-cron";
import { eq, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "./db";
import { runOperator } from "./operator";
import { purgeOldTrash } from "./ops";

const { automations, automationRuns } = schema;

export const PRESETS: Record<string, string> = {
  "every minute": "* * * * *",
  "every morning at 8": "0 8 * * *",
  "every weekday at 9": "0 9 * * 1-5",
  "every saturday": "0 9 * * 6",
  "every sunday evening": "0 18 * * 0",
  "every monday morning": "0 8 * * 1",
};
export function resolveCron(input: string): string | null {
  const key = input.trim().toLowerCase();
  const c = PRESETS[key] ?? input.trim();
  return cron.validate(c) ? c : null;
}

export function serializeAutomation(a: typeof automations.$inferSelect) {
  return a;
}
export function getRuns(automationId: string, limit = 10) {
  return getDb().select().from(automationRuns).where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.startedAt)).limit(limit).all()
    .map((r) => ({ ...r, createdItemIds: r.createdItemIdsJson ? JSON.parse(r.createdItemIdsJson) : [] }));
}

export async function runAutomation(id: string) {
  const db = getDb();
  const a = db.select().from(automations).where(eq(automations.id, id)).get();
  if (!a) return null;
  const runId = nanoid(10);
  const startedAt = new Date().toISOString();
  db.insert(automationRuns).values({ id: runId, automationId: id, startedAt }).run();
  let resultText: string;
  let ids: string[] = [];
  try {
    // Strip a leading schedule phrase ("Every morning at 8:00, ...") so only the action is executed.
    const instruction = a.instruction.replace(/^every [^,]*,\s*/i, "");
    const r = await runOperator({ message: instruction, persist: false });
    resultText = r.assistantMessage.content;
    ids = r.assistantMessage.createdItemIds;
  } catch (e) {
    resultText = `Run failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  const finishedAt = new Date().toISOString();
  db.update(automationRuns).set({ finishedAt, resultText, createdItemIdsJson: JSON.stringify(ids) }).where(eq(automationRuns.id, runId)).run();
  db.update(automations).set({ lastRunAt: startedAt }).where(eq(automations.id, id)).run();
  return { runId, startedAt, finishedAt, resultText, createdItemIds: ids };
}

const g = globalThis as unknown as { __romaTasks?: Map<string, ScheduledTask>; __romaStarted?: boolean };

/** (Re)build cron jobs from DB. Safe to call repeatedly. */
export function syncScheduler() {
  const tasks = (g.__romaTasks ??= new Map());
  for (const t of tasks.values()) { try { t.stop(); } catch {} }
  tasks.clear();
  for (const a of getDb().select().from(automations).all()) {
    if (!a.enabled || !cron.validate(a.cron)) continue;
    tasks.set(a.id, cron.schedule(a.cron, () => { void runAutomation(a.id); }));
  }
}

export function startScheduler() {
  if (g.__romaStarted) return;
  g.__romaStarted = true;
  syncScheduler();
  purgeOldTrash();
  cron.schedule("17 3 * * *", () => purgeOldTrash());
}
