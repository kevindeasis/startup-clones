"""SQLite helpers (stdlib sqlite3, no ORM). Paths are read from env at call time."""
import json
import os
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent


def db_path() -> str:
    return os.environ.get("DATABASE_PATH", "data/docketeer.db")


def upload_dir() -> Path:
    return Path(os.environ.get("UPLOAD_DIR", "data/uploads"))


def letters_dir() -> Path:
    return Path(os.environ.get("LETTERS_DIR", "data/letters"))


def chase_after_days() -> int:
    return int(os.environ.get("CHASE_AFTER_DAYS", "3"))


def invoice_net_days() -> int:
    return int(os.environ.get("INVOICE_NET_DAYS", "30"))


def base_url() -> str:
    return os.environ.get("PUBLIC_BASE_URL", f"http://localhost:{os.environ.get('PORT', '8000')}")


def conn() -> sqlite3.Connection:
    p = Path(db_path())
    p.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(p)
    c.row_factory = sqlite3.Row
    return c


def q(sql: str, args=()) -> list[dict]:
    with closing(conn()) as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def q1(sql: str, args=()) -> dict | None:
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql: str, args=()) -> int:
    with closing(conn()) as c:
        cur = c.execute(sql, args)
        c.commit()
        return cur.lastrowid


def insert(table: str, **vals) -> int:
    cols = ",".join(vals)
    marks = ",".join("?" * len(vals))
    return run(f"INSERT INTO {table}({cols}) VALUES({marks})", tuple(vals.values()))


def update(table: str, row_id: int, **vals) -> None:
    sets = ",".join(f"{k}=?" for k in vals)
    run(f"UPDATE {table} SET {sets} WHERE id=?", (*vals.values(), row_id))


def get_setting(key: str, default: str | None = None) -> str | None:
    r = q1("SELECT value FROM settings WHERE key=?", (key,))
    return r["value"] if r else default


def set_setting(key: str, value: str) -> None:
    run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def today() -> date:
    return date.fromisoformat(get_setting("today") or date.today().isoformat())


def now() -> str:
    """Timestamp on the simulated calendar day (so the timeline follows 'Advance day')."""
    return f"{today().isoformat()}T{datetime.now().strftime('%H:%M:%S')}"


def firm() -> dict:
    return json.loads(get_setting("firm_json") or "{}")


def log_event(matter_id: int | None, kind: str, text: str) -> None:
    insert("events", matter_id=matter_id, kind=kind, text=text, created_at=now())


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def init_db() -> None:
    with closing(conn()) as c:
        c.executescript((HERE / "schema.sql").read_text())
        c.commit()
    if get_setting("today") is None:
        from . import seed
        seed.seed()
