import os
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp(prefix="orderdesk-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["AUTO_APPROVE_THRESHOLD"] = "0.90"
os.environ.pop("ANTHROPIC_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session, SQLModel  # noqa: E402

from app.db import engine, SAMPLES_DIR  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_db, write_samples  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    SQLModel.metadata.drop_all(engine)
    seed_db()
    if not (SAMPLES_DIR / "sms_bluefin.txt").exists():
        write_samples()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def session():
    with Session(engine, expire_on_commit=False) as s:
        yield s
