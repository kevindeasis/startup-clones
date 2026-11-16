
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("LETTERS_DIR", str(tmp_path / "letters"))
    monkeypatch.setenv("MOCK_LLM", "1")
    monkeypatch.setenv("DOCKETEER_TODAY", "2026-11-16")  # Monday
    monkeypatch.setenv("CHASE_AFTER_DAYS", "3")
    monkeypatch.setenv("INVOICE_NET_DAYS", "30")
    return tmp_path


@pytest.fixture()
def client(env):
    from app import db
    from app.main import app
    db.init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def api(client):
    return client
