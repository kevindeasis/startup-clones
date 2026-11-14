import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('pageview','event','error','vital')),
  name TEXT, path TEXT, referrer TEXT, referrer_host TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  country TEXT, browser TEXT, os TEXT, device TEXT, screen_w INTEGER,
  visitor_id TEXT, session_id TEXT, props TEXT, value REAL
);
CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_site_type_name ON events(site_id, type, name);
CREATE INDEX IF NOT EXISTS idx_events_site_session ON events(site_id, session_id);
CREATE INDEX IF NOT EXISTS idx_events_site_visitor ON events(site_id, visitor_id, ts);
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL, steps TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('path','event')), target TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, created_at TEXT NOT NULL, period_days INTEGER NOT NULL,
  changes TEXT NOT NULL, digest_md TEXT NOT NULL, sent_to_slack INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, created_at TEXT NOT NULL, question TEXT NOT NULL,
  answer_md TEXT NOT NULL, sql TEXT, chart TEXT, rows TEXT, mode TEXT NOT NULL CHECK(mode IN ('mock','llm'))
);
`;

type Handles = { rw?: Database.Database; ro?: Database.Database; path?: string };
const globalHandles = globalThis as typeof globalThis & { __hutchDb?: Handles };

export function dbPath(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || "./data/hutch.db");
}

function handles(): Handles {
  const current = (globalHandles.__hutchDb ??= {});
  if (current.path !== dbPath()) {
    current.rw?.close();
    current.ro?.close();
    globalHandles.__hutchDb = { path: dbPath() };
  }
  return globalHandles.__hutchDb!;
}

/** Read-write connection; creates the file and schema on first use. */
export function getDb(): Database.Database {
  const h = handles();
  if (!h.rw) {
    fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
    const db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    h.rw = db;
  }
  return h.rw;
}

/** Separate read-only connection used for every analyst query. */
export function getReadDb(): Database.Database {
  const h = handles();
  getDb();
  if (!h.ro) {
    h.ro = new Database(dbPath(), { readonly: true, timeout: 2000 });
    h.ro.pragma("query_only = ON");
  }
  return h.ro;
}
