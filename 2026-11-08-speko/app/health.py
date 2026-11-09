"""Provider health table, fault injection and circuit breaker."""
from datetime import datetime, timedelta, timezone

from . import config
from .db import conn
from .providers import list_providers


def _now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_rows() -> None:
    with conn() as c:
        for p in list_providers():
            c.execute("INSERT OR IGNORE INTO provider_health(provider, consecutive_failures, fault_mode) VALUES(?,0,'ok')",
                      (p.name,))


def _row_to_state(r, stage=None) -> dict:
    open_until = r["open_until"]
    is_open = bool(open_until and datetime.fromisoformat(open_until) > _now())
    return {"provider": r["provider"], "stage": stage, "consecutive_failures": r["consecutive_failures"],
            "circuit_open": is_open, "open_until": open_until if is_open else None,
            "last_error": r["last_error"], "fault_mode": r["fault_mode"] or "ok"}


def get_state(provider: str) -> dict:
    ensure_rows()
    with conn() as c:
        r = c.execute("SELECT * FROM provider_health WHERE provider=?", (provider,)).fetchone()
    return _row_to_state(r) if r else {"provider": provider, "circuit_open": False, "fault_mode": "ok",
                                       "consecutive_failures": 0, "open_until": None, "last_error": None}


def all_states() -> list[dict]:
    ensure_rows()
    stages = {p.name: p.stage for p in list_providers()}
    with conn() as c:
        rows = c.execute("SELECT * FROM provider_health ORDER BY provider").fetchall()
    return [_row_to_state(r, stages.get(r["provider"])) for r in rows if r["provider"] in stages]


def record_failure(provider: str, error: str) -> None:
    ensure_rows()
    with conn() as c:
        r = c.execute("SELECT consecutive_failures FROM provider_health WHERE provider=?", (provider,)).fetchone()
        n = (r["consecutive_failures"] if r else 0) + 1
        open_until = (_now() + timedelta(seconds=config.OPEN_SECONDS)).isoformat() if n >= config.FAIL_THRESHOLD else None
        if open_until:
            c.execute("UPDATE provider_health SET consecutive_failures=?, last_error=?, open_until=? WHERE provider=?",
                      (n, error, open_until, provider))
        else:
            c.execute("UPDATE provider_health SET consecutive_failures=?, last_error=? WHERE provider=?",
                      (n, error, provider))


def record_success(provider: str) -> None:
    ensure_rows()
    with conn() as c:
        c.execute("UPDATE provider_health SET consecutive_failures=0, open_until=NULL WHERE provider=?", (provider,))


def set_fault(provider: str, mode: str) -> dict:
    ensure_rows()
    with conn() as c:
        c.execute("UPDATE provider_health SET fault_mode=? WHERE provider=?", (mode, provider))
        if mode == "ok":  # clearing a fault also resets the breaker
            c.execute("UPDATE provider_health SET consecutive_failures=0, open_until=NULL, last_error=NULL WHERE provider=?",
                      (provider,))
    return get_state(provider)


def reset_all() -> None:
    ensure_rows()
    with conn() as c:
        c.execute("UPDATE provider_health SET consecutive_failures=0, open_until=NULL, last_error=NULL, fault_mode='ok'")
