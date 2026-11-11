import fs from "node:fs";
import path from "node:path";
import { JSONFilePreset } from "lowdb/node";
import { SCENARIOS, UNITS } from "./curriculum";
import type { DbShape } from "./schemas";

const dbFile = () => process.env.DB_PATH ?? path.join(process.cwd(), "data", "db.json");

async function open() {
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = await JSONFilePreset<DbShape>(file, { units: [], scenarios: [], sessions: [], drills: [] });
  if (db.data.units.length === 0) {
    db.data.units = structuredClone(UNITS);
    db.data.scenarios = structuredClone(SCENARIOS);
    await db.write();
  }
  return db;
}

/** Fresh read of the database (seeds the curriculum on first run). */
export async function readDb(): Promise<DbShape> {
  return (await open()).data;
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialised read-modify-write so concurrent requests cannot clobber each other. */
export function mutate<T>(fn: (data: DbShape) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await open();
    const result = await fn(db.data);
    await db.write();
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
