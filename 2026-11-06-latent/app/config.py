"""Environment-driven settings. Read at call time so tests can override env vars."""
from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_FALLBACK = "I'm not certain about that. Let me connect you with a teammate who can verify."


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    llm_provider: str
    judge_model: str
    base_model: str
    strong_model: str
    flag_threshold: float
    fallback_text: str
    database_path: str
    alert_webhook_url: str
    alert_flag_rate: float
    api_key: str

    @property
    def mock_mode(self) -> bool:
        return self.llm_provider == "mock" or not self.anthropic_api_key


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def get_settings() -> Settings:
    env = os.environ.get
    return Settings(
        anthropic_api_key=(env("ANTHROPIC_API_KEY") or "").strip(),
        llm_provider=(env("LLM_PROVIDER") or "anthropic").strip().lower(),
        judge_model=env("JUDGE_MODEL") or "claude-sonnet-5-5",
        base_model=env("BASE_MODEL") or "claude-haiku-5-5",
        strong_model=env("STRONG_MODEL") or "claude-sonnet-5-5",
        flag_threshold=_float("FLAG_THRESHOLD", 0.5),
        fallback_text=env("FALLBACK_TEXT") or DEFAULT_FALLBACK,
        database_path=env("DATABASE_PATH") or "./data/latent.db",
        alert_webhook_url=(env("ALERT_WEBHOOK_URL") or "").strip(),
        alert_flag_rate=_float("ALERT_FLAG_RATE", 0.5),
        api_key=(env("LATENT_API_KEY") or "").strip(),
    )
