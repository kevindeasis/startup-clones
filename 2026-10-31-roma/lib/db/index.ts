import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { todayISO } from "../dates";

const DDL = `
CREATE TABLE IF NOT EXISTS lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, fields_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0, due_date TEXT, due_time TEXT, fields_json TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, scope TEXT NOT NULL, item_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL, created_item_ids_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message_id TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, "to" TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, instruction TEXT NOT NULL, cron TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, result_text TEXT, created_item_ids_json TEXT);
CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id);
`;

export type DB = BetterSQLite3Database<typeof schema>;

function init(): DB {
  const file = path.resolve(process.env.DATABASE_PATH || "./data/roma.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  seed(db);
  return db;
}

function seed(db: DB) {
  if (db.select().from(schema.lists).all().length > 0) return;
  const now = new Date().toISOString();
  const tasksId = nanoid(10);
  const notesId = nanoid(10);
  db.insert(schema.lists).values([
    { id: tasksId, name: "Tasks", kind: "tasks", createdAt: now },
    { id: notesId, name: "Notes", kind: "notes", createdAt: now },
  ]).run();
  const today = todayISO();
  const mk = (title: string, dueDate: string | null) => ({
    id: nanoid(10), listId: tasksId, title, body: "", kind: "task" as const,
    checked: false, dueDate, dueTime: null, fieldsJson: null, deletedAt: null, createdAt: now, updatedAt: now,
  });
  db.insert(schema.items).values([
    mk("Review today's priorities", today),
    mk("Reply to Sam about the lunch plan", today),
    mk("Renew gym membership", null),
  ]).run();
  db.insert(schema.automations).values({
    id: nanoid(10), name: "Morning priorities",
    instruction: "Every morning at 8:00, create a task 'Review today's priorities'",
    cron: "0 8 * * *", enabled: false, lastRunAt: null, createdAt: now,
  }).run();
}

const g = globalThis as unknown as { __romaDb?: DB };
export function getDb(): DB {
  if (!g.__romaDb) g.__romaDb = init();
  return g.__romaDb;
}
export { schema };
