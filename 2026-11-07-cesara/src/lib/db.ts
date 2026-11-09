import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATABASE_PATH || "./data/claimcheck.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "schema.sql"), "utf8"));
  _db = db;
  return db;
}

export function readDataFile(name: string): string {
  return fs.readFileSync(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", name), "utf8");
}
