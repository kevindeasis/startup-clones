import io


def test_health(client):
    j = client.get("/health").json()
    assert j["status"] == "ok" and j["mock_mode"] is True


def test_pages_render(demo):
    for p in ["/", "/docs-library", "/qa", "/desk", "/investors", "/targeting", "/notes", "/investors/1"]:
        r = demo.get(p)
        assert r.status_code == 200, p
        assert "mock mode" in r.text


def test_upload_and_toggle_delete(client):
    r = client.post("/api/documents", files={"file": ("n.txt", io.BytesIO(b"Widget sales were 55 units. " * 80))},
                    data={"kind": "note", "public": "true"})
    assert r.status_code == 200 and r.json()["chunks"] >= 2
    did = r.json()["id"]
    assert client.post(f"/api/documents/{did}/toggle-public").json()["public"] == 0
    assert client.delete(f"/api/documents/{did}").status_code == 200
    assert client.get("/api/documents").json() == []
    assert client.post("/api/documents", files={"file": ("e.txt", io.BytesIO(b"  "))}).status_code == 400


def test_qa_with_citation(demo):
    r = demo.post("/api/qa", json={"question": "What was Q3 revenue growth?"}).json()
    assert r["citations"] and "18.4" in r["answer"]
    assert r["warnings"] == []


def test_qa_not_covered(demo):
    r = demo.post("/api/qa", json={"question": "What is the CEO's favorite pizza topping?"}).json()
    assert r["answer"].startswith("Not covered by disclosed materials") and r["confidence"] == "low"


def test_desk_refuses_non_public(demo):
    r = demo.post("/api/desk", json={"question": "Are you planning to acquire Helix Dynamics?"}).json()
    assert r["refused"] and r["citations"] == []
    # the same question in call mode can see the internal doc
    r2 = demo.post("/api/qa", json={"question": "Are you planning to acquire Helix Dynamics?"}).json()
    assert r2["citations"]
    # public question works and history persists in session
    r3 = demo.post("/api/desk", json={"question": "What is the full-year revenue outlook?", "session_id": r["session_id"]}).json()
    assert r3["citations"] and len(r3["history"]) == 4


def test_notes_creates_and_upserts(demo):
    notes = ("Meeting with Meridian Growth Partners on 2026-11-09. Attendees: Jane Doe, Bob Lee.\n"
             "They were constructive on margins and backlog but have a concern about customer concentration.\n"
             "Follow up: send the 10-K risk factor excerpt by 2026-11-20.")
    before = len(demo.get("/api/investors").json())
    r = demo.post("/api/notes", json={"notes": notes}).json()
    assert r["extracted"]["investor"] == "Meridian Growth Partners" and not r["investor_created"]
    assert r["extracted"]["sentiment"] == "positive" and r["extracted"]["next_steps"][0]["due"] == "2026-11-20"
    new = demo.post("/api/notes", json={"notes": "Call with Zenith Capital. Skeptical about valuation. Will schedule follow-up next week."}).json()
    assert new["investor_created"]
    invs = demo.get("/api/investors").json()
    assert len(invs) == before + 1
    mer = [i for i in invs if i["name"] == "Meridian Growth Partners"][0]
    assert mer["last_contact"] == "2026-11-09" and mer["next_step"] and mer["meeting_count"] == 2


def test_targeting_ranked(demo):
    r = demo.get("/api/targeting?top_n=5").json()
    scores = [x["score"] for x in r["ranked"]]
    assert len(scores) == 5 and scores == sorted(scores, reverse=True)
    assert all("breakdown" in x and x["rationale"] for x in r["ranked"])
    assert demo.get("/api/targeting?top_n=5").json()["ranked"] == r["ranked"]


def test_announcement_stub(client):
    assert client.post("/api/announcement-model").status_code == 501
