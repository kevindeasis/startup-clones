"""Settings loaded from environment (python-dotenv if available)."""
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover
    pass


def _clean(v: str | None) -> str:
    # tolerate inline comments copied from .env.example
    return (v or "").split("#")[0].strip()


def get_settings() -> dict:
    return {
        "api_key": _clean(os.environ.get("ANTHROPIC_API_KEY")),
        "model": _clean(os.environ.get("ANTHROPIC_MODEL")) or "claude-sonnet-5-5",
        "provider": _clean(os.environ.get("LLM_PROVIDER")).lower(),
        "database_url": _clean(os.environ.get("DATABASE_URL")) or "sqlite:///./data/agnost_clone.db",
        "product_name": _clean(os.environ.get("PRODUCT_NAME")) or "the product",
        "port": int(_clean(os.environ.get("PORT")) or 8000),
    }
