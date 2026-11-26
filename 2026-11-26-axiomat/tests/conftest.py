import os

os.environ["PROVEN_DB_PATH"] = ":memory:"
os.environ["PROVEN_MOCK"] = "1"

import pytest
from fastapi.testclient import TestClient

from app.main import app, db, rules


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def database():
    return db


@pytest.fixture(scope="session")
def rl():
    return rules
