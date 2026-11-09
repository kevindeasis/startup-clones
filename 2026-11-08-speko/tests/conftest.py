import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="speko-test-")
os.environ["DATABASE_URL"] = os.path.join(_tmp, "test.db")
os.environ["MOCK_MODE"] = "1"
for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
    os.environ.pop(k, None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_health(client):
    client.post("/api/admin/reset")
    yield
    client.post("/api/admin/reset")
