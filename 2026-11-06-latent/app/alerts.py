"""Flag-rate webhook alert. Fails silently."""
from __future__ import annotations

import threading

import httpx

from . import db
from .config import Settings

WINDOW = 20
MIN_SAMPLES = 5


def flag_rate_exceeded(settings: Settings) -> tuple[bool, float, int]:
    flags = db.recent_flags(WINDOW)
    if len(flags) < MIN_SAMPLES:
        return False, 0.0, len(flags)
    rate = sum(flags) / len(flags)
    return rate > settings.alert_flag_rate, rate, len(flags)


def _post(url: str, payload: dict) -> None:
    try:
        httpx.post(url, json=payload, timeout=3.0)
    except Exception:
        pass


def maybe_alert(settings: Settings) -> bool:
    """Fire the webhook (in a daemon thread) if configured and the rate is exceeded."""
    if not settings.alert_webhook_url:
        return False
    exceeded, rate, n = flag_rate_exceeded(settings)
    if not exceeded:
        return False
    payload = {
        "alert": "latent_flag_rate_high", "flag_rate": round(rate, 4),
        "window": n, "limit": settings.alert_flag_rate,
    }
    threading.Thread(target=_post, args=(settings.alert_webhook_url, payload), daemon=True).start()
    return True
