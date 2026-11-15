"""SQLite helpers (stdlib sqlite3, no ORM)."""
import sqlite3
from pathlib import Path

from . import config

SCHEMA = Path(__file__).with_name("schema.sql")


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or config.database_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA.read_text())
    conn.commit()


def is_seeded(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT COUNT(*) FROM practice").fetchone()[0] > 0


def reset_db(conn: sqlite3.Connection) -> dict:
    """Drop everything, recreate the schema and seed demo data (idempotent)."""
    from . import seed

    conn.commit()
    objs = conn.execute(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND type IN ('trigger','table')"
    ).fetchall()
    conn.execute("PRAGMA foreign_keys = OFF")
    for o in objs:
        if o["type"] == "trigger":
            conn.execute(f'DROP TRIGGER IF EXISTS "{o["name"]}"')
    for o in objs:
        if o["type"] == "table":
            conn.execute(f'DROP TABLE IF EXISTS "{o["name"]}"')
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")
    init_db(conn)
    return seed.seed(conn)


def rows(conn, sql: str, params=()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn, sql: str, params=()) -> dict | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None
