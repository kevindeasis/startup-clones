import io

import docx
import pymupdf

from app import db


def test_health_mock(client):
    r = client.get("/health").json()
    assert r["status"] == "ok" and r["mode"] == "mock" and "model" in r


def test_seeded_sample_case_listed(client):
    html = client.get("/").text
    assert "Ellison" in html and "sample" in html


def test_sample_generator_writes_pdfs(tmp_path):
    from scripts.make_sample_records import build_bundle
    paths = build_bundle(tmp_path / "s")
    assert len(paths) >= 3
    assert sum(len(pymupdf.open(str(p))) for p in paths) >= 28


def test_full_pipeline_on_sample(client, sample_case):
    cid = sample_case
    st = client.get(f"/cases/{cid}/status").json()
    assert st["stage"] == "idle" and st["case_status"] == "ready"
    s = st["stats"]
    assert s["blanks"] >= 2 and s["duplicates"] >= 2 and s["documents"] >= 6 and s["events"] >= 12 and s["llm_runs"] > 0
    pages = db.q("SELECT * FROM pages WHERE case_id=?", (cid,))
    assert any("near-duplicate" in (p["dup_reason"] or "") for p in pages)
    assert any(p["dup_reason"] == "exact duplicate" for p in pages)
    kept = sorted(p["bates"] for p in pages if p["bates"])
    assert kept == [f"CHR-{i:06d}" for i in range(1, len(kept) + 1)]
    assert all(not p["bates"] for p in pages if p["is_blank"] or p["is_duplicate"])
    docs = db.q("SELECT * FROM documents WHERE case_id=? ORDER BY order_index", (cid,))
    dates = [d["service_date"] for d in docs if d["service_date"]]
    assert dates == sorted(dates)
    valid = {p["bates"] for p in pages if p["bates"]}
    events = db.q("SELECT * FROM events WHERE case_id=?", (cid,))
    for e in events:
        cites = db.jloads(e["source_pages"])
        assert cites and set(cites) <= valid
    assert len(db.q("SELECT * FROM conflicts WHERE case_id=?", (cid,))) >= 1
    # pages screen + case screen render
    assert "CHR-000001" in client.get(f"/cases/{cid}/pages").text
    assert "Chronology" in client.get(f"/cases/{cid}").text


def test_page_png_and_api(client, sample_case):
    p = db.q("SELECT id FROM pages WHERE case_id=? AND bates IS NOT NULL LIMIT 1", (sample_case,), one=True)
    r = client.get(f"/pages/{p['id']}.png")
    assert r.status_code == 200 and r.content[:4] == b"\x89PNG"
    ev = db.q("SELECT * FROM events WHERE case_id=? LIMIT 1", (sample_case,), one=True)
    bates = db.jloads(ev["source_pages"])[0]
    pid = db.q("SELECT id FROM pages WHERE case_id=? AND bates=?", (sample_case, bates), one=True)["id"]
    j = client.get(f"/api/pages/{pid}?event_id={ev['id']}").json()
    assert j["quote"] == ev["quote"] and j["quote_found"] is True and j["text"]


def test_event_crud_and_conflict_resolve(client, sample_case):
    cid = sample_case
    ev = db.q("SELECT * FROM events WHERE case_id=? ORDER BY id LIMIT 2", (cid,))
    a, b = ev[0]["id"], ev[1]["id"]
    r = client.patch(f"/api/events/{a}", json={"date": "March 20, 2024", "summary": "Edited summary.", "significance": "high"}).json()
    assert r["date"] == "2024-03-20" and r["summary"] == "Edited summary." and r["significance"] == "high"
    assert client.patch(f"/api/events/{a}", json={"significance": "extreme"}).status_code == 422
    v = client.post(f"/api/events/{a}/verify").json()
    assert v["verified"] is True and v["verified_by"] and v["verified_at"]
    assert client.get(f"/cases/{cid}/status").json()["stats"]["verified"] == 1
    assert client.post(f"/api/events/{a}/verify").json()["verified"] is False
    assert client.delete(f"/api/events/{b}").status_code == 200
    assert client.delete(f"/api/events/{b}").status_code == 404
    bates = db.q("SELECT bates FROM pages WHERE case_id=? AND bates IS NOT NULL LIMIT 1", (cid,), one=True)["bates"]
    n = client.post(f"/api/cases/{cid}/events", json={"date": "2024-04-01", "summary": "Manual entry.", "source_pages": [bates]})
    assert n.status_code == 201 and n.json()["created_by"] == "user"
    assert client.post(f"/api/cases/{cid}/events", json={"summary": "x", "source_pages": ["CHR-999999"]}).status_code == 422
    conf = db.q("SELECT id FROM conflicts WHERE case_id=? LIMIT 1", (cid,), one=True)["id"]
    assert client.post(f"/api/conflicts/{conf}/resolve", json={"note": "checked chart"}).json()["resolved"] is True
    row = db.q("SELECT * FROM conflicts WHERE id=?", (conf,), one=True)
    assert row["resolved"] == 1 and row["resolution_note"] == "checked chart"


def test_docx_export_reopens(client, sample_case):
    r = client.get(f"/cases/{sample_case}/export.docx")
    assert r.status_code == 200
    d = docx.Document(io.BytesIO(r.content))
    text = "\n".join(p.text for p in d.paragraphs)
    assert "Draft" in text and "Unresolved conflicts" in text
    assert len(d.tables) >= 3
    assert any("CHR-" in c.text for t in d.tables for row in t.rows for c in row.cells)


def test_pdf_export_opens_with_3_pages(client, sample_case):
    r = client.get(f"/cases/{sample_case}/export.pdf")
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    doc = pymupdf.open(stream=r.content, filetype="pdf")
    assert len(doc) >= 3
    assert "Draft" in doc[0].get_text()


def test_upload_and_new_case(client):
    cid = client.post("/cases", data={"name": "Doe v. Hospital", "firm_name": "Firm"}).json()["id"]
    bad = client.post(f"/cases/{cid}/files", files=[("files", ("x.pdf", b"not a pdf", "application/pdf"))])
    assert bad.status_code == 400
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "OPERATIVE REPORT\nDate of service: 2024-01-02\nPerformed a procedure on 2024-01-02. " * 3)
    data = doc.tobytes()
    ok = client.post(f"/cases/{cid}/files", files=[("files", ("one.pdf", data, "application/pdf"))])
    assert ok.json()["added"] == ["one.pdf"]
    assert client.post(f"/cases/{cid}/paginate").status_code == 202
    assert client.get(f"/cases/{cid}/status").json()["stats"]["pages_in"] == 1
    assert client.post("/cases/9999/paginate").status_code == 404
