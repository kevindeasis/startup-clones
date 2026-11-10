import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "t.db"))
    monkeypatch.setenv("MOCK_LLM", "1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def demo(client):
    assert client.post("/api/demo/load").status_code == 200
    return client
