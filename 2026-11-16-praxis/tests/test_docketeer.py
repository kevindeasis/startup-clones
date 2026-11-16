import json

from docx import Document

from app import db

PAGES = ["/", "/inbox", "/inbox/1", "/matters", "/matters/1", "/outbox", "/activity", "/billing"]


def inquiry_id(like):
    return db.q1("SELECT id FROM inquiries WHERE subject LIKE ?", (f"%{like}%",))["id"]


def run_intake(c, like):
    r = c.post(f"/api/inquiries/{inquiry_id(like)}/run")
    assert r.status_code == 200, r.text
    return r.json()


def pending(c, type_=None):
    rows = c.get("/api/approvals?status=pending").json()
    return [a for a in rows if type_ is None or a["type"] == type_]


def onboard(c, like="Fired after"):
    """Intake -> approve letter -> sign. Returns (matter_id, token)."""
    res = run_intake(c, like)
    letter = next(a for a in pending(c, "engagement_letter") if a["inquiry_id"] == inquiry_id(like))
    r = c.post(f"/api/approvals/{letter['id']}/approve", json={})
    assert r.status_code == 200, r.text
    mid = r.json()["matter_id"]
    token = db.q1("SELECT portal_token FROM matters WHERE id=?", (mid,))["portal_token"]
    r = c.post(f"/api/portal/{token}/sign", json={"name": "Maria Santos", "agree": "on"})
    assert r.status_code == 200, r.text
    return mid, token, res


def upload(c, token, doc_id, text, name="doc.txt", note=""):
    r = c.post(f"/api/portal/{token}/upload", data={"document_id": str(doc_id), "note": note}, files={"file": (name, text.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    return r.json()


def doc_by(mid, word):
    return next(d for d in db.q("SELECT * FROM matter_documents WHERE matter_id=?", (mid,)) if word in d["item"].lower())


def outbox_equals_approved():
    n_out = db.q1("SELECT COUNT(*) c FROM outbox WHERE sent_at IS NOT NULL")["c"]
    n_app = db.q1("SELECT COUNT(*) c FROM approvals WHERE status='approved'")["c"]
    # seed data has no outbox rows; every outbox row must correspond to exactly one approved approval
    assert n_out == n_app


# 1
def test_health_mock(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["mode"] == "mock" and r.json()["model"] == "claude-opus-5-5"


def test_mock_when_no_key(client, monkeypatch):
    monkeypatch.delenv("MOCK_LLM")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/health").json()["mode"] == "mock"


# 2
def test_pages(client):
    for p in PAGES:
        assert client.get(p).status_code == 200, p
    tok = db.q1("SELECT portal_token FROM matters")["portal_token"]
    r = client.get(f"/portal/{tok}")
    assert r.status_code == 200 and "Recent updates" in r.text
    assert client.get("/portal/nope").status_code == 404
    assert client.get("/api/matters/1").json()["stage"] == "active"


# 3
def test_intake_accept(client):
    res = run_intake(client, "Fired after")
    assert res["decision"] == "accept"
    cf = next(s for s in res["steps"] if s["name"] == "Conflict check")["result"]
    assert not cf["conflict"]
    types = sorted(a["type"] for a in pending(client) if a["inquiry_id"] == inquiry_id("Fired after"))
    assert types == ["engagement_letter", "reply_email"]
    reply = next(a for a in pending(client, "reply_email"))
    assert "Wednesday, November 18 at 10:00 AM ET" not in reply["draft_text"]  # Tue is first business day
    assert "Tuesday, November 17 at 10:00 AM ET" in reply["draft_text"] and "Thursday, November 19 at 3:00 PM ET" in reply["draft_text"]
    # re-run replaces rather than duplicates
    run_intake(client, "Fired after")
    assert len(pending(client, "reply_email")) == 1


# 4
def test_intake_conflict(client):
    res = run_intake(client, "Vendor breached")
    assert res["decision"] == "needs_lawyer"
    cf = next(s for s in res["steps"] if s["name"] == "Conflict check")["result"]
    assert cf["conflict"]
    hit = next(m for m in cf["matches"] if m["matched_name"] == "Northwind Logistics LLC")
    assert hit["score"] >= 85 and hit["source"] == "client" and hit["role"] == "adverse"
    mine = [a for a in pending(client) if a["inquiry_id"] == inquiry_id("Vendor breached")]
    assert [a["type"] for a in mine] == ["reply_email"]
    assert "partner will review within one business day" in mine[0]["draft_text"]
    assert "Northwind" not in mine[0]["draft_text"]


def test_intake_crestline_conflict(client):
    res = run_intake(client, "former contractor")
    assert res["decision"] == "needs_lawyer"
    assert any(m["matched_name"].startswith("Crestline") and m["conflicting"] for m in next(s for s in res["steps"] if s["name"] == "Conflict check")["result"]["matches"])


# 5
def test_intake_decline_and_others(client):
    res = run_intake(client, "DUI")
    assert res["decision"] == "decline"
    assert any("decline_area" in r and "criminal" in r for r in res["reasons"])
    reply = pending(client, "reply_email")[0]
    assert "lawyer-referral service" in reply["draft_text"] and "not legal advice" in reply["draft_text"]
    assert not pending(client, "engagement_letter")
    assert run_intake(client, "Divorce")["decision"] == "decline"
    assert run_intake(client, "Need a lawyer")["decision"] == "needs_lawyer"
    assert run_intake(client, "Vendor contract breach")["decision"] == "accept"
    assert run_intake(client, "Cease and desist")["decision"] == "accept"


# 6
def test_approve_letter_and_reject_feedback(client):
    run_intake(client, "Fired after")
    letter = pending(client, "engagement_letter")[0]
    assert db.q1("SELECT COUNT(*) c FROM clients WHERE name='Maria Santos'")["c"] == 0
    r = client.post(f"/api/approvals/{letter['id']}/approve", json={"draft_text": letter["draft_text"] + "\n\nEDITED BY LAWYER"})
    assert r.status_code == 200
    mid = r.json()["matter_id"]
    m = db.q1("SELECT * FROM matters WHERE id=?", (mid,))
    assert m["stage"] == "engagement_sent"
    assert db.q1("SELECT COUNT(*) c FROM clients WHERE name='Maria Santos'")["c"] == 1
    ob = db.q1("SELECT * FROM outbox WHERE matter_id=?", (mid,))
    assert ob["attachment_path"].endswith(f"{mid}.docx")
    doc = Document(ob["attachment_path"])
    assert any("EDITED BY LAWYER" in p.text for p in doc.paragraphs)
    assert client.post(f"/api/approvals/{letter['id']}/approve", json={}).status_code == 409
    # reject with reason -> next draft sees it
    reply = pending(client, "reply_email")[0]
    assert client.post(f"/api/approvals/{reply['id']}/reject", json={"reason": ""}).status_code == 400
    assert client.post(f"/api/approvals/{reply['id']}/reject", json={"reason": "Too formal, mention evening availability"}).status_code == 200
    assert db.q1("SELECT reject_reason FROM approvals WHERE id=?", (reply["id"],))["reject_reason"] == "Too formal, mention evening availability"
    run_intake(client, "Fired after")
    run = db.q1("SELECT prompt FROM agent_runs WHERE agent='draft_reply' ORDER BY id DESC")
    assert "Too formal, mention evening availability" in run["prompt"]
    outbox_equals_approved()


# 7 + 8
def test_onboarding_and_verification(client):
    mid, token, _ = onboard(client)
    m = db.q1("SELECT stage FROM matters WHERE id=?", (mid,))
    assert m["stage"] == "onboarding"
    docs = db.q("SELECT * FROM matter_documents WHERE matter_id=?", (mid,))
    templ = db.q("SELECT * FROM checklist_templates WHERE practice_area='employment'")
    assert len(templ) < len(docs) <= len(templ) + 2
    assert all(d["status"] == "requested" for d in docs)
    assert len([a for a in pending(client, "document_request") if a["matter_id"] == mid]) == 1
    assert client.post(f"/api/portal/{token}/sign", json={"name": "Maria Santos", "agree": "on"}).status_code == 409

    idd = doc_by(mid, "photo id")
    assert upload(client, token, idd["id"], "DRIVER LICENSE\nName: Robert Jones\nEXPIRES: 2031-01-01")["status"] == "mismatch"
    assert upload(client, token, idd["id"], "DRIVER LICENSE\nName: Maria Santos\nEXPIRES: 2020-01-01")["status"] == "expired"
    r = upload(client, token, idd["id"], "DRIVER LICENSE\nName: Maria Santos\nEXPIRES: 2031-01-01")
    assert r["status"] == "verified" and r["message"] == "Received, verified"
    assert client.post(f"/api/portal/{token}/upload", data={"document_id": str(idd["id"])}, files={"file": ("x.exe", b"hi")}).status_code == 400
    assert client.post(f"/api/portal/{token}/upload", data={"document_id": str(idd["id"])}, files={"file": ("big.txt", b"a" * (10 * 1024 * 1024 + 1))}).status_code == 413
    # not everything verified yet -> no status update
    assert not [a for a in pending(client, "status_update") if a["matter_id"] == mid]
    upload(client, token, doc_by(mid, "employment agreement")["id"], "EMPLOYMENT AGREEMENT\nbetween Brightwave Media Inc. and Maria Santos")
    upload(client, token, doc_by(mid, "termination")["id"], "Termination letter\nYour employment has been terminated effective 2026-11-01.")
    last = upload(client, token, doc_by(mid, "pay stub")["id"], "PAY STUB\nPay period 2026-10\nGross pay $3,500")
    assert last["status_update_approval_id"]
    su = [a for a in pending(client, "status_update") if a["matter_id"] == mid]
    assert len(su) == 1
    assert db.q1("SELECT stage FROM matters WHERE id=?", (mid,))["stage"] == "onboarding"
    assert client.post(f"/api/approvals/{su[0]['id']}/approve", json={}).status_code == 200
    assert db.q1("SELECT stage FROM matters WHERE id=?", (mid,))["stage"] == "active"
    # portal never leaks internal data
    page = client.get(f"/portal/{token}").text
    assert "rationale" not in page.lower() and "conflict" not in page.lower()


def test_image_upload_needs_lawyer(client):
    mid, token, _ = onboard(client)
    d = doc_by(mid, "photo id")
    r = client.post(f"/api/portal/{token}/upload", data={"document_id": str(d["id"]), "note": "my passport"}, files={"file": ("id.png", b"\x89PNG", "image/png")})
    assert r.json()["status"] == "needs_lawyer"
    assert client.post(f"/api/documents/{d['id']}/verify").json()["status"] == "verified"


# 9
def test_chasers(client):
    mid, token, _ = onboard(client)
    assert client.post("/api/settings/advance?days=4").json()["today"] == "2026-11-20"
    out = client.post("/agents/run-daily").json()
    chasers = pending(client, "chaser")
    outstanding_matters = {r["matter_id"] for r in db.q("SELECT matter_id FROM matter_documents WHERE status IN ('requested','mismatch','expired','unreadable')")}
    assert len(chasers) == len(out["chasers"])
    for m in outstanding_matters:  # exactly one chaser per matter with outstanding documents
        assert len([c for c in chasers if c["matter_id"] == m and json.loads(json.dumps(c["payload"]))["kind"] == "client"]) == 1
    assert mid in {c["matter_id"] for c in chasers}
    client.post("/agents/run-daily")
    assert len(pending(client, "chaser")) == len(chasers)  # no duplicates
    mine = next(c for c in chasers if c["matter_id"] == mid)
    assert "friendly" in mine["rationale"]
    # second chaser after approving the first is direct, third flags pause
    client.post(f"/api/approvals/{mine['id']}/approve", json={})
    client.post("/api/settings/advance?days=3")
    client.post("/agents/run-daily")
    second = next(c for c in pending(client, "chaser") if c["matter_id"] == mid)
    assert "direct" in second["rationale"]
    client.post(f"/api/approvals/{second['id']}/approve", json={})
    client.post("/api/settings/advance?days=3")
    client.post("/agents/run-daily")
    third = next(c for c in pending(client, "chaser") if c["matter_id"] == mid)
    assert "paused" in third["draft_text"]


def test_task_chasers(client):
    client.post("/api/settings/advance?days=5")  # seeded client task (matter 1) and counterparty task (matter 2) become overdue
    out = client.post("/agents/run-daily").json()
    kinds = {(c["matter_id"], c["payload"]["kind"]) for c in pending(client, "chaser")}
    assert (1, "client") in kinds and (2, "counterparty") in kinds
    cp = next(c for c in pending(client, "chaser") if c["payload"]["kind"] == "counterparty")
    assert "legal action" not in cp["draft_text"].lower() and cp["to_email"] == "tbrandt@brandtlaw.example"


# 10
def test_invoice_flow(client, monkeypatch):
    monkeypatch.setenv("INVOICE_NET_DAYS", "0")
    mid = 1  # seeded active matter with unbilled time
    entries = db.q("SELECT * FROM time_entries WHERE matter_id=? AND invoice_id IS NULL", (mid,))
    expected = round(sum(e["minutes"] for e in entries) / 60 * 350, 2)
    r = client.post(f"/api/matters/{mid}/invoice")
    assert r.status_code == 200
    inv = r.json()
    assert inv["status"] == "draft" and inv["subtotal_usd"] == expected and inv["number"].startswith("HV-2026-")
    assert client.post(f"/api/matters/{mid}/invoice").status_code == 400  # nothing left to bill
    appr = next(a for a in pending(client, "invoice_email") if a["matter_id"] == mid)
    token = db.q1("SELECT portal_token FROM matters WHERE id=?", (mid,))["portal_token"]
    assert inv["number"] not in client.get(f"/portal/{token}").text
    client.post(f"/api/approvals/{appr['id']}/approve", json={})
    assert db.q1("SELECT status FROM invoices WHERE id=?", (inv["invoice_id"],))["status"] == "sent"
    assert inv["number"] in client.get(f"/portal/{token}").text
    client.post("/api/settings/advance?days=8")
    client.post("/agents/run-daily")
    rem = [a for a in pending(client, "payment_reminder") if a["payload"]["invoice_id"] == inv["invoice_id"]]
    assert [a["payload"]["stage"] for a in rem] == [1]
    client.post("/agents/run-daily")
    assert len([a for a in pending(client, "payment_reminder") if a["payload"]["invoice_id"] == inv["invoice_id"]]) == 1
    client.post("/api/settings/advance?days=7")
    client.post("/agents/run-daily")
    rem = [a for a in pending(client, "payment_reminder") if a["payload"]["invoice_id"] == inv["invoice_id"]]
    assert sorted(a["payload"]["stage"] for a in rem) == [1, 2]
    assert db.q1("SELECT reminder_stage FROM invoices WHERE id=?", (inv["invoice_id"],))["reminder_stage"] == 2
    assert client.post(f"/api/portal/{token}/pay/{inv['invoice_id']}").json()["status"] == "paid"
    assert client.post(f"/api/portal/{token}/pay/{inv['invoice_id']}").status_code == 409
    assert db.q1("SELECT paid_at FROM invoices WHERE id=?", (inv["invoice_id"],))["paid_at"]


def test_seeded_overdue_invoice_and_billing(client):
    client.post("/agents/run-daily")
    rem = pending(client, "payment_reminder")
    assert len(rem) == 1 and rem[0]["payload"]["stage"] == 2  # 20 days overdue
    assert "paus" not in rem[0]["draft_text"].lower()
    assert "$" in client.get("/billing").text


def test_rejected_invoice_releases_time(client):
    inv = client.post("/api/matters/1/invoice").json()
    a = next(a for a in pending(client, "invoice_email"))
    client.post(f"/api/approvals/{a['id']}/reject", json={"reason": "Too many entries"})
    assert db.q1("SELECT status FROM invoices WHERE id=?", (inv["invoice_id"],))["status"] == "void"
    assert client.post("/api/matters/1/invoice").status_code == 200


def test_tasks_time_notes(client):
    t = client.post("/api/matters/1/tasks", data={"title": "Call", "owner": "lawyer", "due_date": "2026-12-01"}).json()["id"]
    assert client.post(f"/api/tasks/{t}/done").json()["status"] == "done"
    assert client.post("/api/matters/1/time", data={"minutes": "30", "description": "x"}).status_code == 200
    assert client.post("/api/matters/1/notes", data={"text": "internal"}).status_code == 200
    assert "internal" in client.get("/matters/1").text
    assert client.post("/api/inquiries", data={"name": "A B", "email": "a@b.co", "message": "hi", "source": "email"}).status_code == 200


# 11
def test_outbox_only_from_approvals(client):
    assert db.q1("SELECT COUNT(*) c FROM outbox")["c"] == 0
    run_intake(client, "Fired after")
    client.post("/agents/run-daily")
    client.post("/api/matters/1/invoice")
    assert db.q1("SELECT COUNT(*) c FROM outbox")["c"] == 0  # drafting never sends
    for a in pending(client)[:3]:
        client.post(f"/api/approvals/{a['id']}/approve", json={})
    outbox_equals_approved()
    for a in pending(client):
        client.post(f"/api/approvals/{a['id']}/reject", json={"reason": "no"})
    outbox_equals_approved()
    assert db.q1("SELECT COUNT(*) c FROM outbox")["c"] == 3
