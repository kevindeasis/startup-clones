"""DuckDB access: seeded on startup, queried through read-only cursors with a timeout."""
from __future__ import annotations

import datetime as dt
import decimal
import os
import threading
from pathlib import Path

import duckdb

from .rules import ROOT


def jsonable(v):
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


class Database:
    def __init__(self, path: str | None = None):
        path = path or os.environ.get("PROVEN_DB_PATH") or "data/proven.duckdb"
        self.path = path
        seed = (ROOT / "data" / "seed.sql").read_text()
        if path == ":memory:":
            self.con = duckdb.connect(":memory:")
            self.con.execute(seed)
            self.read_only = False  # in-memory DBs cannot be reopened read-only; verifier gates SQL
        else:
            p = Path(path) if os.path.isabs(path) else ROOT / path
            p.parent.mkdir(parents=True, exist_ok=True)
            for f in (p, Path(str(p) + ".wal")):
                if f.exists():
                    f.unlink()
            rw = duckdb.connect(str(p))
            rw.execute(seed)
            rw.close()
            self.con = duckdb.connect(str(p), read_only=True)
            self.read_only = True

    def query(self, sql: str, limit: int | None = 1000, timeout: float = 5.0):
        """Run one SELECT. Returns (columns, rows). Raises on error or timeout."""
        cur = self.con.cursor()
        timer = threading.Timer(timeout, cur.interrupt)
        timer.start()
        try:
            res = cur.execute(sql)
            cols = [d[0] for d in res.description]
            raw = res.fetchmany(limit) if limit else res.fetchall()
            return cols, [[jsonable(v) for v in r] for r in raw]
        finally:
            timer.cancel()
            cur.close()

    def scalar(self, sql: str):
        return self.query(sql, limit=1)[1][0][0]

    def schema(self):
        cols, rows = self.query(
            "SELECT table_name, column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'main' ORDER BY table_name, ordinal_position", limit=None)
        return rows

    def distinct(self, table: str, column: str) -> list:
        return [r[0] for r in self.query(f"SELECT DISTINCT {column} FROM {table} ORDER BY 1", limit=None)[1]]
