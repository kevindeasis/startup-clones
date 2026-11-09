import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL, attrs_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS evidence(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, account_id INTEGER, kind TEXT NOT NULL CHECK(kind IN ('usage','ticket','call')), text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hypotheses(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, statement TEXT NOT NULL, confidence REAL NOT NULL, rationale TEXT NOT NULL DEFAULT '', evidence_ids_json TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS interviews(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, account_id INTEGER, token TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('pending','active','done')), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, interview_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('assistant','user')), content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS findings(id INTEGER PRIMARY KEY AUTOINCREMENT, hypothesis_id INTEGER NOT NULL, interview_id INTEGER NOT NULL, stance TEXT NOT NULL CHECK(stance IN ('supports','contradicts','neutral')), quote TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_evidence_project ON evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_accounts_project ON accounts(project_id);
`;

const g = globalThis as unknown as { __pothDbs?: Map<string, Database.Database> };

export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  const file = process.env.DATABASE_PATH || "./data/poth.db";
  g.__pothDbs ??= new Map();
  let db = g.__pothDbs.get(file);
  if (!db) {
    db = openDb(file);
    g.__pothDbs.set(file, db);
  }
  return db;
}

export const now = () => new Date().toISOString();
