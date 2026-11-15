import os
import shutil
import tempfile

import pytest

os.environ["MOCK_LLM"] = "1"
os.environ.pop("ANTHROPIC_API_KEY", None)

_TEMPLATE = {}


@pytest.fixture(scope="session")
def template_db():
    d = tempfile.mkdtemp(prefix="chairfill-tests-")
    path = os.path.join(d, "template.db")
    os.environ["DATABASE_PATH"] = path
    from app import db

    conn = db.connect(path)
    db.reset_db(conn)
    conn.close()
    yield path
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture()
def dbpath(template_db, tmp_path):
    p = str(tmp_path / "test.db")
    shutil.copy(template_db, p)
    os.environ["DATABASE_PATH"] = p
    os.environ["MOCK_LLM"] = "1"
    return p


@pytest.fixture()
def conn(dbpath):
    from app import db

    c = db.connect(dbpath)
    yield c
    c.close()


@pytest.fixture()
def client(dbpath):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


class Caller:
    """Helper that talks to a conversation over the HTTP API."""

    def __init__(self, client, channel="inbound"):
        self.client = client
        self.id = client.post("/api/conversations", json={"channel": channel}).json()["id"]

    def say(self, text):
        r = self.client.post(f"/api/conversations/{self.id}/messages", json={"text": text})
        assert r.status_code == 200, r.text
        return r.json()


@pytest.fixture()
def caller(client):
    return Caller(client)
