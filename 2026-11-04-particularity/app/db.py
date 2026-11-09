"""SQLite storage helpers. Data dir is read from CASEWORK_DATA_DIR at call time."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(
  id INTEGER PRIMARY KEY AUTOINCREMENT, business TEXT, target_url TEXT, checkout_url TEXT, cancel_url TEXT,
  status TEXT DEFAULT 'open', priority TEXT DEFAULT 'P3', harm_estimate_cents INTEGER DEFAULT 0,
  summary TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS evidence(
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER REFERENCES cases(id), kind TEXT, url TEXT,
  captured_at TEXT, html_path TEXT, html_sha256 TEXT, screenshot_path TEXT, screenshot_sha256 TEXT,
  text_excerpt TEXT, meta_json TEXT);
CREATE TABLE IF NOT EXISTS findings(
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER REFERENCES cases(id),
  evidence_id INTEGER REFERENCES evidence(id), category TEXT, severity TEXT, confidence REAL,
  title TEXT, summary TEXT, quote TEXT, legal_elements_json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS complaints(
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER REFERENCES cases(id), text TEXT, business TEXT,
  category TEXT, harm_estimate_cents INTEGER, priority TEXT, summary TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS decisions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER REFERENCES cases(id), action TEXT, note TEXT,
  actor TEXT DEFAULT 'staff', created_at TEXT);
CREATE TABLE IF NOT EXISTS letters(
  id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER REFERENCES cases(id), body TEXT, created_at TEXT);
CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions
  BEGIN SELECT RAISE(ABORT, 'decisions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS decisions_no_delete BEFORE DELETE ON decisions
  BEGIN SELECT RAISE(ABORT, 'decisions is append-only'); END;
"""

STATUS_FOR_ACTION = {"warning_letter": "letter_pending", "escalate": "escalated",
                     "needs_more_evidence": "open", "dismiss": "closed"}


def data_dir() -> Path:
    return Path(os.environ.get("CASEWORK_DATA_DIR", "./data")).resolve()


def evidence_dir() -> Path:
    return data_dir() / "evidence"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(data_dir() / "casework.db")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    evidence_dir().mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript(SCHEMA)


def _insert(table: str, values: dict) -> int:
    cols = ",".join(values)
    qs = ",".join("?" * len(values))
    with connect() as c:
        cur = c.execute(f"INSERT INTO {table}({cols}) VALUES({qs})", list(values.values()))
        return cur.lastrowid


def create_case(target_url, checkout_url=None, cancel_url=None, business="") -> int:
    return _insert("cases", dict(business=business or "", target_url=target_url, checkout_url=checkout_url,
                                 cancel_url=cancel_url, created_at=now()))


def update_case(case_id: int, **fields) -> None:
    if not fields:
        return
    sets = ",".join(f"{k}=?" for k in fields)
    with connect() as c:
        c.execute(f"UPDATE cases SET {sets} WHERE id=?", [*fields.values(), case_id])


def delete_case_rows(case_id: int) -> None:
    with connect() as c:
        for t in ("evidence", "findings", "complaints", "letters"):
            c.execute(f"DELETE FROM {t} WHERE case_id=?", (case_id,))
        c.execute("DELETE FROM cases WHERE id=?", (case_id,))


def add_evidence(case_id: int, ev: dict) -> int:
    return _insert("evidence", dict(
        case_id=case_id, kind=ev["kind"], url=ev["url"], captured_at=ev["captured_at"],
        html_path=ev["html_path"], html_sha256=ev["html_sha256"], screenshot_path=ev["screenshot_path"],
        screenshot_sha256=ev["screenshot_sha256"], text_excerpt=ev["text_excerpt"],
        meta_json=json.dumps(ev.get("meta", {}))))


def add_finding(case_id: int, evidence_id, f: dict) -> int:
    return _insert("findings", dict(
        case_id=case_id, evidence_id=evidence_id, category=f["category"], severity=f["severity"],
        confidence=f["confidence"], title=f["title"], summary=f["summary"], quote=f["quote"],
        legal_elements_json=json.dumps(f["legal_elements"]), created_at=now()))


def add_complaint(c: dict) -> int:
    return _insert("complaints", dict(
        case_id=c.get("case_id"), text=c["text"], business=c["business"], category=c["category"],
        harm_estimate_cents=c["harm_estimate_cents"], priority=c["priority"], summary=c["summary"],
        created_at=now()))


def add_decision(case_id: int, action: str, note: str, actor: str = "staff") -> int:
    """Append-only; also updates case status."""
    did = _insert("decisions", dict(case_id=case_id, action=action, note=note, actor=actor, created_at=now()))
    update_case(case_id, status=STATUS_FOR_ACTION[action])
    return did


def add_letter(case_id: int, body: str) -> int:
    return _insert("letters", dict(case_id=case_id, body=body, created_at=now()))


def _rows(sql: str, args=()) -> list[dict]:
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def find_case_by_business(name: str):
    name = (name or "").strip().lower()
    if not name or name == "unknown":
        return None
    for c in _rows("SELECT * FROM cases ORDER BY id"):
        b = (c["business"] or "").lower()
        if b and (name in b or b in name):
            return c
    return None


def list_cases() -> list[dict]:
    return _rows("""SELECT c.*, (SELECT COUNT(*) FROM findings f WHERE f.case_id=c.id) AS finding_count
                    FROM cases c ORDER BY c.id DESC""")


def list_complaints() -> list[dict]:
    return _rows("""SELECT m.*, c.business AS case_business FROM complaints m
                    LEFT JOIN cases c ON c.id=m.case_id ORDER BY m.id DESC""")


def get_case(case_id: int):
    rows = _rows("SELECT * FROM cases WHERE id=?", (case_id,))
    if not rows:
        return None
    case = rows[0]
    ev = _rows("SELECT * FROM evidence WHERE case_id=? ORDER BY id", (case_id,))
    for e in ev:
        e["meta"] = json.loads(e.pop("meta_json") or "{}")
        e["screenshot_url"] = f"/evidence/{e['screenshot_path']}"
        e["html_url"] = f"/evidence/{e['html_path']}"
    fnd = _rows("SELECT * FROM findings WHERE case_id=? ORDER BY id", (case_id,))
    for f in fnd:
        f["legal_elements"] = json.loads(f.pop("legal_elements_json") or "[]")
    case["evidence"] = ev
    case["findings"] = fnd
    case["complaints"] = _rows("SELECT * FROM complaints WHERE case_id=? ORDER BY id", (case_id,))
    case["decisions"] = _rows("SELECT * FROM decisions WHERE case_id=? ORDER BY id", (case_id,))
    case["letters"] = _rows("SELECT * FROM letters WHERE case_id=? ORDER BY id DESC", (case_id,))
    return case
