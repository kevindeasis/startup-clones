from .conftest import png_bytes

SAMPLE_PDF_TEXT = "FIRST NOTICE OF LOSS\nDate of Loss: 2026-03-14\n"


def make_pdf(text: str) -> bytes:
    from fpdf import FPDF

    p = FPDF()
    p.add_page()
    p.set_font("Helvetica", size=12)
    p.multi_cell(0, 6, text)
    return bytes(p.output())


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json() == {"ok": True, "provider": "mock"}


def test_create_and_get_claim(client, claim):
    assert claim["status"] == "open" and len(claim["id"]) == 12
    r = client.get(f"/api/claims/{claim['id']}")
    assert r.status_code == 200 and r.json()["documents"] == []
    assert any(c["id"] == claim["id"] for c in client.get("/api/claims").json())
    assert client.post("/api/claims", json={"claim_number": "x", "line_of_business": "boat", "claimant_name": "a", "loss_date": "2026-01-01"}).status_code == 422


def test_upload_txt_pdf_png_and_delete(client, claim):
    cid = claim["id"]
    r = client.post(f"/api/claims/{cid}/documents", files={"file": ("n.txt", b"Adjuster note.", "text/plain")}, data={"doc_type": "adjuster_notes"})
    assert r.status_code == 200 and r.json()["extracted_text"] == "Adjuster note."
    r = client.post(f"/api/claims/{cid}/documents", files={"file": ("f.pdf", make_pdf(SAMPLE_PDF_TEXT), "application/pdf")}, data={"doc_type": "fnol"})
    assert r.status_code == 200 and "Date of Loss" in r.json()["extracted_text"] and r.json()["page_count"] == 1
    r = client.post(f"/api/claims/{cid}/documents", files={"file": ("p.png", png_bytes(), "image/png")}, data={"doc_type": "photo"})
    assert r.status_code == 200
    doc_id = r.json()["id"]
    assert len(client.get(f"/api/claims/{cid}").json()["documents"]) == 3
    assert client.delete(f"/api/claims/{cid}/documents/{doc_id}").status_code == 200
    assert len(client.get(f"/api/claims/{cid}").json()["documents"]) == 2
    bad = client.post(f"/api/claims/{cid}/documents", files={"file": ("x.exe", b"MZ", "application/octet-stream")}, data={"doc_type": "other"})
    assert bad.status_code == 400


def test_investigate_requires_documents(client, claim):
    assert client.post(f"/api/claims/{claim['id']}/investigate").status_code == 409


def test_demo_investigation_and_exports(client):
    cid = client.post("/api/demo").json()["claim_id"]
    iid = client.post(f"/api/claims/{cid}/investigate").json()["investigation_id"]
    d = client.get(f"/api/investigations/{iid}").json()
    assert d["status"] == "done", d
    r = d["report"]
    assert r["executive_summary"] and len(r["timeline"]["events"]) >= 3
    assert len(r["inconsistencies"]) >= 1 and r["coverage"]["position"] == "not_covered"
    assert 0 <= r["risk"]["score"] <= 100 and len(r["recommended_actions"]) >= 2 and len(r["decision_log"]) >= 5
    assert client.get(f"/api/claims/{cid}").json()["status"] == "investigated"
    page = client.get(f"/claims/{cid}/report")
    assert page.status_code == 200 and r["inconsistencies"][0]["title"] in page.text and r["executive_summary"][:40] in page.text
    for fmt, ctype in (("md", "text/markdown"), ("pdf", "application/pdf"), ("json", "application/json")):
        e = client.get(f"/api/investigations/{iid}/export.{fmt}")
        assert e.status_code == 200 and e.headers["content-type"].startswith(ctype)
    assert client.get(f"/api/investigations/{iid}/export.pdf").content.startswith(b"%PDF")
    assert client.get("/").status_code == 200 and client.get(f"/claims/{cid}").status_code == 200
