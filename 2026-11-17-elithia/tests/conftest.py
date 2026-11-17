import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODE", raising=False)
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def sample_case(client):
    """The seeded sample case id, paginated and with a chronology built."""
    cases = client.get("/").text
    assert "sample" in cases
    import app.db as db
    cid = db.q("SELECT id FROM cases ORDER BY id LIMIT 1", one=True)["id"]
    assert client.post(f"/cases/{cid}/paginate").status_code == 202
    assert client.post(f"/cases/{cid}/chronology").status_code == 202
    return cid
