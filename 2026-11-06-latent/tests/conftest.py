import os
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "sdk"))

SOURCES = ["Q3 revenue was $3.1M, up 12% year over year.", "The company has 42 employees."]
GOOD = "Q3 revenue was $3.1M, up 12% year over year."
BAD = "Q3 revenue was $4.2M, up 38%, according to CFO Dana Whitfield."


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("LATENT_API_KEY", "")
    monkeypatch.setenv("FLAG_THRESHOLD", "0.5")
    monkeypatch.setenv("FALLBACK_TEXT", "FALLBACK")
    monkeypatch.setenv("ALERT_WEBHOOK_URL", "")
    return monkeypatch


@pytest.fixture()
def client(env):
    from app.main import app

    with TestClient(app) as c:
        yield c
