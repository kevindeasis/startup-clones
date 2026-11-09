import type Database from "better-sqlite3";

const DDL = `
CREATE TABLE IF NOT EXISTS lawyers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, practice_areas TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, channel TEXT NOT NULL, requester_name TEXT NOT NULL, requester_email TEXT, subject TEXT NOT NULL, body TEXT NOT NULL, attachments TEXT NOT NULL, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS matters (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), title TEXT NOT NULL, summary TEXT NOT NULL, practice_area TEXT NOT NULL, urgency TEXT NOT NULL, status TEXT NOT NULL, owner_id TEXT REFERENCES lawyers(id), waiting_on TEXT, brief TEXT NOT NULL, draft_reply TEXT NOT NULL, chosen_option TEXT, clarifying_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS playbook_clauses (id TEXT PRIMARY KEY, practice_area TEXT NOT NULL, title TEXT NOT NULL, standard_position TEXT NOT NULL, fallback_position TEXT NOT NULL, walk_away TEXT NOT NULL, approver TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS precedents (id TEXT PRIMARY KEY, matter_id TEXT NOT NULL REFERENCES matters(id), practice_area TEXT NOT NULL, summary TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, matter_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

export function migrate(sqlite: Database.Database) {
  sqlite.exec(DDL);
}
