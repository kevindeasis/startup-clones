"""SQLite persistence (stdlib sqlite3, WAL mode, no ORM)."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  score REAL NOT NULL,
  threshold REAL NOT NULL,
  flagged INTEGER NOT NULL,
  risky_sentence TEXT,
  source_sentence TEXT,
  failure_type TEXT,
  explanation TEXT,
  policy TEXT NOT NULL,
  action TEXT NOT NULL,
  final_answer TEXT NOT NULL,
  judge_model TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_answers_created ON answers(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def connect() -> sqlite3.Connection:
    path = get_settings().database_path
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def get_threshold() -> float:
    conn = connect()
    try:
        row = conn.execute("SELECT value FROM settings WHERE key='threshold'").fetchone()
    finally:
        conn.close()
    if row:
        try:
            return float(row["value"])
        except ValueError:
            pass
    return get_settings().flag_threshold


def set_threshold(value: float) -> None:
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES('threshold', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(value),),
        )
        conn.commit()
    finally:
        conn.close()


def insert_answer(**f: Any) -> str:
    """Insert an answer row; returns its id. `sources` is a list of strings."""
    rid = uuid.uuid4().hex
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO answers(id, created_at, prompt, answer, sources_json, score,
               threshold, flagged, risky_sentence, source_sentence, failure_type,
               explanation, policy, action, final_answer, judge_model, latency_ms)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rid, now_iso(), f["prompt"], f["answer"], json.dumps(f["sources"]),
                f["score"], f["threshold"], int(f["flagged"]), f.get("risky_sentence"),
                f.get("source_sentence"), f.get("failure_type"), f.get("explanation"),
                f["policy"], f["action"], f["final_answer"], f["judge_model"],
                f["latency_ms"],
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return rid


def _row(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["sources"] = json.loads(d.pop("sources_json"))
    d["flagged"] = bool(d["flagged"])
    return d


def get_answer(rid: str) -> dict[str, Any] | None:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM answers WHERE id=?", (rid,)).fetchone()
    finally:
        conn.close()
    return _row(row) if row else None


def list_answers(tab: str = "pending", limit: int = 200) -> list[dict[str, Any]]:
    """Flagged answers, newest first. tab: pending | reviewed | all."""
    where = "flagged=1"
    if tab == "pending":
        where += " AND review_status='pending'"
    elif tab == "reviewed":
        where += " AND review_status!='pending'"
    conn = connect()
    try:
        rows = conn.execute(
            f"SELECT * FROM answers WHERE {where} ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    return [_row(r) for r in rows]


def set_review(rid: str, decision: str) -> bool:
    conn = connect()
    try:
        cur = conn.execute(
            "UPDATE answers SET review_status=?, reviewed_at=? WHERE id=?",
            (decision, now_iso(), rid),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def labeled_rows() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM answers WHERE review_status IN ('confirmed','cleared') "
            "ORDER BY created_at ASC, rowid ASC"
        ).fetchall()
    finally:
        conn.close()
    return [_row(r) for r in rows]


def iter_labeled() -> Iterator[dict[str, Any]]:
    yield from labeled_rows()


def recent_flags(n: int = 20) -> list[bool]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT flagged FROM answers ORDER BY created_at DESC, rowid DESC LIMIT ?", (n,)
        ).fetchall()
    finally:
        conn.close()
    return [bool(r["flagged"]) for r in rows]


def stats() -> dict[str, Any]:
    conn = connect()
    try:
        r = conn.execute(
            """SELECT COUNT(*) AS scored,
                      COALESCE(SUM(flagged),0) AS flagged,
                      COALESCE(SUM(review_status='confirmed'),0) AS confirmed,
                      COALESCE(SUM(review_status='cleared'),0) AS cleared,
                      COALESCE(SUM(flagged=1 AND review_status='pending'),0) AS pending
               FROM answers"""
        ).fetchone()
    finally:
        conn.close()
    scored, flagged = r["scored"], r["flagged"]
    reviewed = r["confirmed"] + r["cleared"]
    return {
        "scored": scored,
        "flagged": flagged,
        "flag_rate": round(flagged / scored, 4) if scored else 0.0,
        "confirmed": r["confirmed"],
        "cleared": r["cleared"],
        "reviewed": reviewed,
        "pending": r["pending"],
        "precision": round(r["confirmed"] / reviewed, 4) if reviewed else None,
        "threshold": get_threshold(),
    }
