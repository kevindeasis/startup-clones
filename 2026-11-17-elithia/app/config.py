"""Runtime configuration, read from environment variables at call time."""
import os
from pathlib import Path


def data_dir() -> Path:
    p = Path(os.environ.get("DATA_DIR") or "./data").resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def db_path() -> Path:
    return data_dir() / "chronolog.db"


def api_key() -> str:
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL") or "claude-sonnet-5-5"


def llm_mode() -> str:
    """Resolve the effective mode: 'mock' or 'live'."""
    m = (os.environ.get("LLM_MODE") or "auto").strip().lower()
    if m == "mock":
        return "mock"
    if m == "live":
        return "live"
    return "live" if api_key() else "mock"


def port() -> int:
    try:
        return int(os.environ.get("PORT") or 8000)
    except ValueError:
        return 8000
