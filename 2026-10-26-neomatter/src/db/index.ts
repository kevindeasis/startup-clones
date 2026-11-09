import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { migrate } from "./migrate";

const globalForDb = globalThis as unknown as { __frontdoorDb?: ReturnType<typeof create> };

function create() {
  const file = process.env.DATABASE_PATH || "./data/frontdoor.db";
  fs.mkdirSync(path.dirname(path.resolve(/* turbopackIgnore: true */ file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__frontdoorDb ?? (globalForDb.__frontdoorDb = create());
export * from "./schema";
