"""Environment-driven configuration. Read lazily so tests can override env vars."""
import os

SUPPORTED_STAGES = ("stt", "llm", "tts")
FAIL_THRESHOLD = 3          # consecutive failures before the breaker opens
OPEN_SECONDS = 60           # how long an open breaker excludes a provider
MAX_ATTEMPTS = 3            # max providers tried per stage
SLOW_PENALTY_MS = 800.0     # extra reported latency for fault mode "slow"


def database_path() -> str:
    url = os.getenv("DATABASE_URL", "./speko.db")
    for prefix in ("sqlite:///", "sqlite://"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url


def has_keys() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY"))


def mock_mode() -> bool:
    """MOCK_MODE=1 by default when no API keys are present."""
    v = os.getenv("MOCK_MODE")
    if v is not None and v.strip() != "":
        return v.strip().lower() in ("1", "true", "yes", "on")
    return not has_keys()
