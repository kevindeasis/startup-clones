import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS studies (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, topic TEXT NOT NULL, goal TEXT NOT NULL,
  teams_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  study_id TEXT NOT NULL REFERENCES studies(id),
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, team TEXT NOT NULL, site TEXT NOT NULL, role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('invited','in_progress','completed')),
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coverage (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id), areas_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extractions (
  participant_id TEXT PRIMARY KEY REFERENCES participants(id),
  json TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS syntheses (
  study_id TEXT PRIMARY KEY REFERENCES studies(id),
  json TEXT NOT NULL, mermaid TEXT NOT NULL, model TEXT NOT NULL,
  interview_count INTEGER NOT NULL, created_at TEXT NOT NULL
);
`;

let instance: Database.Database | undefined;

export function dbPath(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? "./data/worktalk.db");
}

export function getDb(): Database.Database {
  if (!instance) {
    const file = dbPath();
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    instance = new Database(file);
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");
    instance.exec(SCHEMA);
  }
  return instance;
}
