import sqlite3
from contextlib import contextmanager

from .config import database_path

SCHEMA = """
CREATE TABLE IF NOT EXISTS benchmark_results(
  id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, stage TEXT, language TEXT,
  metric_quality REAL, latency_ms REAL, cost_usd REAL, n_samples INTEGER, run_at TEXT);
CREATE INDEX IF NOT EXISTS idx_bench ON benchmark_results(stage, language, provider);
CREATE TABLE IF NOT EXISTS provider_health(
  provider TEXT PRIMARY KEY, consecutive_failures INTEGER DEFAULT 0,
  open_until TEXT, last_error TEXT, fault_mode TEXT DEFAULT 'ok');
CREATE TABLE IF NOT EXISTS turns(
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, language TEXT, use_case TEXT,
  priority TEXT, transcript TEXT, reply TEXT, trace_json TEXT);
"""


@contextmanager
def conn():
    c = sqlite3.connect(database_path(), timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
