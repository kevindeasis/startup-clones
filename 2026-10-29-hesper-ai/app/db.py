"""SQLite access (stdlib sqlite3, no ORM). DATA_DIR is read at call time."""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS claims(
  id TEXT PRIMARY KEY, claim_number TEXT, line_of_business TEXT, claimant_name TEXT,
  loss_date TEXT, description TEXT, status TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, claim_id TEXT REFERENCES claims(id), filename TEXT, doc_type TEXT,
  mime TEXT, size_bytes INTEGER, storage_path TEXT, extracted_text TEXT,
  page_count INTEGER, forensics_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS investigations(
  id TEXT PRIMARY KEY, claim_id TEXT REFERENCES claims(id), status TEXT, current_step TEXT,
  started_at TEXT, finished_at TEXT, report_json TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS decision_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT REFERENCES investigations(id),
  step TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, duration_ms INTEGER,
  output_json TEXT, created_at TEXT);
"""


def data_dir() -> Path:
    p = Path(os.environ.get("DATA_DIR", "./data")).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def conn():
    c = sqlite3.connect(data_dir() / "claimsleuth.db", timeout=30)
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn():
        pass


def rows(sql: str, args: tuple = ()) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def row(sql: str, args: tuple = ()) -> dict | None:
    r = rows(sql, args)
    return r[0] if r else None


def execute(sql: str, args: tuple = ()) -> None:
    with conn() as c:
        c.execute(sql, args)


# ---- claims ----------------------------------------------------------------
def create_claim(claim_number, line_of_business, claimant_name, loss_date, description) -> dict:
    cid, ts = new_id(), now()
    execute(
        "INSERT INTO claims VALUES(?,?,?,?,?,?,?,?,?)",
        (cid, claim_number, line_of_business, claimant_name, loss_date, description, "open", ts, ts),
    )
    return get_claim(cid)


def get_claim(cid: str) -> dict | None:
    return row("SELECT * FROM claims WHERE id=?", (cid,))


def set_claim_status(cid: str, status: str) -> None:
    execute("UPDATE claims SET status=?, updated_at=? WHERE id=?", (status, now(), cid))


# ---- documents -------------------------------------------------------------
def doc_public(d: dict) -> dict:
    d = dict(d)
    d["forensics"] = json.loads(d.pop("forensics_json") or "[]")
    return d


def list_documents(claim_id: str, full_text: bool = False) -> list[dict]:
    out = [doc_public(d) for d in rows("SELECT * FROM documents WHERE claim_id=? ORDER BY created_at, rowid", (claim_id,))]
    if not full_text:
        for d in out:
            d["extracted_text"] = (d["extracted_text"] or "")[:500]
    return out


def get_document(doc_id: str) -> dict | None:
    d = row("SELECT * FROM documents WHERE id=?", (doc_id,))
    return doc_public(d) if d else None


# ---- investigations --------------------------------------------------------
def latest_investigation(claim_id: str, status: str | None = None) -> dict | None:
    if status:
        return row("SELECT * FROM investigations WHERE claim_id=? AND status=? ORDER BY started_at DESC, rowid DESC LIMIT 1", (claim_id, status))
    return row("SELECT * FROM investigations WHERE claim_id=? ORDER BY started_at DESC, rowid DESC LIMIT 1", (claim_id,))


def log_decision(inv_id, step, model, in_tok, out_tok, duration_ms, output) -> None:
    execute(
        "INSERT INTO decision_log(investigation_id,step,model,input_tokens,output_tokens,duration_ms,output_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (inv_id, step, model, in_tok, out_tok, duration_ms, json.dumps(output, default=str), now()),
    )


def decision_log(inv_id: str) -> list[dict]:
    out = rows("SELECT * FROM decision_log WHERE investigation_id=? ORDER BY id", (inv_id,))
    for r in out:
        r["output"] = json.loads(r.pop("output_json") or "null")
    return out
