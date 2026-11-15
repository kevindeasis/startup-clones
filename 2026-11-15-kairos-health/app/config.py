"""Runtime configuration, read from environment variables on every call."""
import os
from datetime import date, datetime

from dotenv import load_dotenv

load_dotenv()


def database_path() -> str:
    return os.environ.get("DATABASE_PATH", "./chairfill.db")


def recall_months() -> int:
    try:
        return int(os.environ.get("RECALL_MONTHS", "6"))
    except ValueError:
        return 6


def api_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def model() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-sonnet-5-5"


def is_mock() -> bool:
    flag = os.environ.get("MOCK_LLM", "").strip().lower() in ("1", "true", "yes", "on")
    return flag or not api_key()


def mode() -> str:
    return "mock" if is_mock() else "live"


def now() -> datetime:
    return datetime.now().replace(second=0, microsecond=0)


def today() -> date:
    return now().date()
