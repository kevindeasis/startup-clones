"""SQLite persistence (stdlib sqlite3)."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, claimant TEXT, matter_type TEXT,
  firm_name TEXT, report_title TEXT, footer TEXT, created_at TEXT, status TEXT DEFAULT 'new');
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, filename TEXT, path TEXT,
  page_count INTEGER DEFAULT 0, uploaded_at TEXT);
CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, file_id INTEGER, page_index INTEGER,
  text TEXT, text_hash TEXT, is_blank INTEGER DEFAULT 0, is_duplicate INTEGER DEFAULT 0, duplicate_of INTEGER,
  dup_reason TEXT, doc_type TEXT, facility TEXT, provider TEXT, service_date TEXT, page_role TEXT, confidence REAL,
  document_id INTEGER, bates TEXT, png_path TEXT);
CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, doc_type TEXT, facility TEXT,
  provider TEXT, service_date TEXT, bates_start TEXT, bates_end TEXT, order_index INTEGER, undated INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, document_id INTEGER, date TEXT,
  time TEXT, facility TEXT, provider TEXT, category TEXT, summary TEXT, significance TEXT, quote TEXT, source_pages TEXT,
  verified INTEGER DEFAULT 0, verified_by TEXT, verified_at TEXT, created_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS conflicts(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, event_ids TEXT,
  description TEXT, resolved INTEGER DEFAULT 0, resolution_note TEXT);
CREATE TABLE IF NOT EXISTS llm_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER, purpose TEXT, model TEXT,
  mode TEXT, input_chars INTEGER, output_chars INTEGER, latency_ms INTEGER, created_at TEXT);
CREATE INDEX IF NOT EXISTS ix_pages_case ON pages(case_id);
CREATE INDEX IF NOT EXISTS ix_events_case ON events(case_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(str(config.db_path()), timeout=30)
    con.row_factory = sqlite3.Row
    return con


@contextmanager
def conn():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with conn() as c:
        c.executescript(SCHEMA)


def q(sql, args=(), one=False):
    with conn() as c:
        rows = [dict(r) for r in c.execute(sql, args).fetchall()]
    if one:
        return rows[0] if rows else None
    return rows


def execute(sql, args=()):
    with conn() as c:
        cur = c.execute(sql, args)
        return cur.lastrowid


def jloads(s, default=None):
    try:
        return json.loads(s) if s else default
    except (TypeError, ValueError):
        return default
