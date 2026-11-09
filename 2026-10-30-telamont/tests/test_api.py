from pathlib import Path

import pytest

SAMPLE = Path(__file__).resolve().parent.parent / "sample_docs"
NAMES = ["01_prime_contract.pdf", "02_specifications_div03.pdf", "03_drawing_notes_S-001.pdf"]


def upload_samples(client, pid):
    files = [("files", (n, (SAMPLE / n).read_bytes(), "application/pdf")) for n in NAMES]
    r = client.post(f"/api/projects/{pid}/documents", files=files)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def project(client):
    pid = client.post("/api/projects", json={"name": "Maple Street"}).json()["id"]
    docs = upload_samples(client, pid)
    return pid, docs


def test_health_reports_provider(client):
    j = client.get("/api/health").json()
    assert j["ok"] is True and j["llm_provider"] == "mock"


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "Girder" in r.text


def test_upload_documents(client, project):
    pid, docs = project
    assert [d["status"] for d in docs] == ["extracted"] * 3
    assert [d["page_count"] for d in docs] == [2, 2, 1]
    assert [d["kind"] for d in docs] == ["contract", "spec", "drawing"]
    detail = client.get(f"/api/projects/{pid}").json()
    assert detail["counts"]["documents"] == 3


def test_bad_upload_marked_failed(client):
    pid = client.post("/api/projects", json={"name": "x"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/documents", files=[("files", ("scan.pdf", b"%PDF-garbage", "application/pdf"))])
    assert r.json()[0]["status"] == "failed" and r.json()[0]["message"]


def test_detect_patch_filter(client, project):
    pid, _ = project
    risks = client.post(f"/api/projects/{pid}/detect").json()
    assert len(risks) >= 5
    contras = [r for r in risks if r["category"] == "contradiction"]
    assert contras and any(len({c["document_id"] for c in r["citations"]}) >= 2 for r in contras)
    rid = risks[0]["id"]
    p = client.patch(f"/api/risks/{rid}", json={"status": "in_review", "owner": "Dana"}).json()
    assert p["status"] == "in_review" and p["owner"] == "Dana"
    assert client.patch(f"/api/risks/{rid}", json={"status": "bogus"}).status_code == 400
    assert all(r["category"] == "contradiction" for r in client.get(f"/api/projects/{pid}/risks?category=contradiction").json())
    assert [r["id"] for r in client.get(f"/api/projects/{pid}/risks?status=in_review").json()] == [rid]
    # re-detect keeps non-open risks, no duplicates
    again = client.post(f"/api/projects/{pid}/detect").json()
    assert len(again) == len(risks)
    assert [r for r in again if r["id"] == rid][0]["status"] == "in_review"


def test_ask_and_history(client, project):
    pid, _ = project
    a = client.post(f"/api/projects/{pid}/ask", json={"question": "What concrete strength is required for footings?"}).json()
    assert a["citations"] and "4,000 psi" in a["answer"]
    assert {"document_id", "filename", "page", "quote"} <= set(a["citations"][0])
    assert len(client.get(f"/api/projects/{pid}/questions").json()) == 1


def test_ask_no_basis(client, project):
    pid, _ = project
    a = client.post(f"/api/projects/{pid}/ask", json={"question": "zebra xylophone"}).json()
    assert a["answer"].startswith("No basis found") and a["citations"] == []


def test_notice(client, project):
    pid, _ = project
    risk = client.post(f"/api/projects/{pid}/detect").json()[0]
    n = client.post(f"/api/risks/{risk['id']}/notice").json()["notice"]
    assert n.strip() and risk["title"] in n


def test_delete_document_invalidates(client, project):
    pid, docs = project
    client.post(f"/api/projects/{pid}/detect")
    assert client.delete(f"/api/documents/{docs[1]['id']}").status_code == 200
    a = client.post(f"/api/projects/{pid}/ask", json={"question": "footings 4,000 psi"}).json()
    assert all(c["filename"] != NAMES[1] for c in a["citations"])


def test_detect_anthropic_without_key_is_400(client, project, monkeypatch):
    pid, _ = project
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    r = client.post(f"/api/projects/{pid}/detect")
    assert r.status_code == 400 and "ANTHROPIC_API_KEY" in r.json()["detail"]
    h = client.get("/api/health").json()
    assert h["ok"] is True and h["llm_provider"] == "anthropic"


def test_404s(client):
    assert client.get("/api/projects/9999").status_code == 404
    assert client.patch("/api/risks/9999", json={}).status_code == 404
