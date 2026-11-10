import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'other',
  public INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investors(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, style TEXT DEFAULT '',
  aum_musd REAL DEFAULT 0, mandate TEXT DEFAULT '', sectors TEXT DEFAULT '', holds_us INTEGER DEFAULT 0,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS interactions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, investor_id INTEGER NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  date TEXT NOT NULL, summary TEXT DEFAULT '', topics_json TEXT DEFAULT '[]', sentiment TEXT DEFAULT 'neutral',
  concerns_json TEXT DEFAULT '[]', next_steps_json TEXT DEFAULT '[]', raw_notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS qa_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, question TEXT NOT NULL,
  response_json TEXT NOT NULL, created_at TEXT NOT NULL);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    conn = sqlite3.connect(config.database_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)


def rows(sql: str, args=()) -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def one(sql: str, args=()) -> dict | None:
    r = rows(sql, args)
    return r[0] if r else None


def jl(s):
    try:
        return json.loads(s or "[]")
    except Exception:
        return []
