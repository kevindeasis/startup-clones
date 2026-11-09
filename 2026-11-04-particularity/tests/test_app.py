"""Acceptance tests (mock mode). A real uvicorn thread serves the demo pages for Playwright."""
import os
import socket
import sqlite3
import tempfile
import threading
import time

import pytest

_tmp = tempfile.mkdtemp(prefix="casework-test-")
os.environ["CASEWORK_DATA_DIR"] = _tmp
os.environ["CASEWORK_MOCK"] = "1"

import uvicorn  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, rulebook  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def base_url():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True); t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(timeout=5)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def case(client, base_url):
    r = client.post("/api/cases", json={"target_url": f"{base_url}/demo/", "checkout_url": f"{base_url}/demo/checkout",
                                        "cancel_url": f"{base_url}/demo/account"})
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["mock"] is True


def test_demo_pages(client):
    for p in ("/demo/", "/demo/checkout", "/demo/account", "/demo/terms"):
        assert client.get(p).status_code == 200, p


def test_rejects_non_http(client):
    assert client.post("/api/cases", json={"target_url": "file:///etc/passwd"}).status_code == 422
    assert client.post("/api/cases", json={"target_url": "http://x/", "cancel_url": "ftp://x"}).status_code == 422


def test_case_investigation(case):
    kinds = {e["kind"] for e in case["evidence"]}
    assert {"landing", "landing_recheck", "checkout", "cancel"} <= kinds
    for e in case["evidence"]:
        assert e["html_sha256"] and e["screenshot_sha256"]
        png = db.evidence_dir() / e["screenshot_path"]
        assert png.is_file() and png.read_bytes()[:4] == b"\x89PNG"
    assert len(case["findings"]) >= 4
    cats = {f["category"] for f in case["findings"]}
    assert {"hidden_fee", "cancellation_obstacle", "undisclosed_renewal", "fake_urgency"} <= cats
    valid = rulebook.valid_ids()
    for f in case["findings"]:
        assert f["legal_elements"] and set(f["legal_elements"]) <= valid
        assert f["quote"].strip()


def test_same_page_timer_sampling(case):
    landing = next(e for e in case["evidence"] if e["kind"] == "landing")
    samples = landing["meta"]["timer_samples"]
    assert len(samples) >= 5 and all({"t", "timers", "stock"} <= set(x) for x in samples)
    fu = next(f for f in case["findings"] if f["category"] == "fake_urgency")
    assert "while the page stayed open" in fu["summary"]


def test_complaint_links_case(client, case):
    r = client.post("/api/complaints", json={"text": "Bright Mattress charged me an $89 service fee that wasn't in the "
                                                      "ad and told me I have to call to cancel"})
    assert r.status_code == 200
    j = r.json()
    assert j["category"] in ("hidden_fee", "cancellation_obstacle")
    assert j["harm_estimate_cents"] >= 8900
    assert j["case_id"] == case["id"]


def test_decision_and_letter(client, case):
    cid = case["id"]
    r = client.post(f"/api/cases/{cid}/decisions", json={"action": "warning_letter", "note": "ok"})
    assert r.status_code == 200
    got = client.get(f"/api/cases/{cid}").json()
    assert got["status"] == "letter_pending"
    assert [d["action"] for d in got["decisions"]] == ["warning_letter"]
    r = client.post(f"/api/cases/{cid}/letter")
    body = r.json()["body"]
    assert case["business"] in body and "DRAFT" in body


def test_decisions_append_only():
    with db.connect() as c:
        with pytest.raises(sqlite3.DatabaseError):
            c.execute("UPDATE decisions SET note='x'")
        with pytest.raises(sqlite3.DatabaseError):
            c.execute("DELETE FROM decisions")


def test_pages_render(client, case):
    html = client.get("/").text
    assert client.get("/").status_code == 200 and "MOCK MODE" in html and case["business"] in html
    r = client.get(f"/cases/{case['id']}")
    assert r.status_code == 200
    assert "hidden_fee" in r.text and "junkfee_total_price" in r.text and "checklist" in r.text
    assert client.get("/complaints").status_code == 200
    assert client.get("/evidence/../casework.db").status_code in (404, 422)
