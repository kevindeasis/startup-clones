import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DB } from "./types";

export function emptyDb(): DB {
  return {
    accounts: [], usage: [], tickets: [], invoices: [], notes: [], projects: [],
    tasks: [], signals: [], actions: [], briefs: [], snapshots: [],
  };
}

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data");
}
export function dbFile(): string {
  return path.join(dataDir(), "db.json");
}
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/** Reads the whole store from disk (small file; keeps multiple processes consistent). */
export function readDb(): DB {
  try {
    return { ...emptyDb(), ...(JSON.parse(fs.readFileSync(dbFile(), "utf8")) as Partial<DB>) };
  } catch {
    return emptyDb();
  }
}

export function writeDb(db: DB): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${dbFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile());
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialised read-modify-write; the callback may mutate `db` in place. */
export function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const db = readDb();
    const out = await fn(db);
    writeDb(db);
    return out;
  });
  chain = run.catch(() => undefined);
  return run;
}
