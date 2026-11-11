import { readDb } from "./db";
import { dayKey, deriveProgress, nextScenarioId, scenarioStates } from "./logic";
import type { DbShape, Pattern } from "./schemas";

export function progressFrom(db: DbShape) {
  const progress = deriveProgress(db.sessions, dayKey(new Date()));
  const states = scenarioStates(db.units, db.scenarios, progress.completedScenarioIds);
  const nextId = nextScenarioId(db.units, db.scenarios, states);
  const focusScenarioId = progress.topPattern ? nextId : null;
  return { progress, states, focusScenarioId, focusPattern: (progress.topPattern ?? null) as Pattern | null };
}

export async function getProgress() {
  return progressFrom(await readDb());
}
