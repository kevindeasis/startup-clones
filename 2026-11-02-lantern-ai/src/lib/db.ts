import type { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// process.getBuiltinModule avoids bundler issues with the `node:sqlite` specifier.
const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const g = globalThis as unknown as { __lanternDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, title TEXT, job_description TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS hiring_models(id TEXT PRIMARY KEY, role_id TEXT REFERENCES roles(id), version INTEGER, status TEXT,
  criteria_json TEXT, taste_notes_json TEXT, change_summary TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, role_id TEXT REFERENCES roles(id), name TEXT, source_filename TEXT,
  resume_text TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id),
  hiring_model_id TEXT REFERENCES hiring_models(id), overall_score REAL, recommendation TEXT, summary TEXT,
  criteria_scores_json TEXT, open_questions_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id), decision TEXT,
  reason TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS interview_plans(id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES candidates(id),
  questions_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS analytics_messages(id TEXT PRIMARY KEY, role_id TEXT REFERENCES roles(id), role TEXT,
  content TEXT, created_at TEXT);
`;

export function db(): DatabaseSync {
  if (!g.__lanternDb) {
    const file = path.resolve(process.env.DATABASE_PATH || './data/lantern.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const d = new sqlite.DatabaseSync(file);
    d.exec('PRAGMA journal_mode = WAL;');
    d.exec(SCHEMA);
    g.__lanternDb = d;
  }
  return g.__lanternDb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export const all = (sql: string, ...p: unknown[]) => db().prepare(sql).all(...(p as never[])) as Row[];
export const get = (sql: string, ...p: unknown[]) => db().prepare(sql).get(...(p as never[])) as Row | undefined;
export const run = (sql: string, ...p: unknown[]) => db().prepare(sql).run(...(p as never[]));
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
