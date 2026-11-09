import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_tmp = tempfile.mkdtemp(prefix="girder-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["ANTHROPIC_API_KEY"] = ""

import pytest  # noqa: E402

SAMPLE = ROOT / "sample_docs"


@pytest.fixture(scope="session", autouse=True)
def sample_docs():
    if not (SAMPLE / "01_prime_contract.pdf").exists():
        sys.path.insert(0, str(ROOT / "scripts"))
        import make_sample_docs

        make_sample_docs.build()
    return SAMPLE


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.llm import reset_provider
    from app.main import app

    reset_provider()
    with TestClient(app) as c:
        yield c
