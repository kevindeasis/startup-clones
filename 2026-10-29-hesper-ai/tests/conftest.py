import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def claim(client):
    r = client.post("/api/claims", json={"claim_number": "C-1", "line_of_business": "auto", "claimant_name": "Sam Roe",
                                         "loss_date": "2026-03-14", "description": "Rear-end collision."})
    assert r.status_code == 200
    return r.json()


def png_bytes(exif: bool = False) -> bytes:
    img = Image.new("RGB", (20, 20), "red")
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x0131] = "Adobe Photoshop 25.0"
        ex.get_ifd(0x8769)[0x9003] = "2026:01:01 10:00:00"
        img.save(buf, "JPEG", exif=ex)
    else:
        img.save(buf, "PNG")
    return buf.getvalue()
