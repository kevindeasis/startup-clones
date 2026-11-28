from fastapi.testclient import TestClient

from tests.conftest import DISCOUNT_TRIGGER, discount_messages, make_trace, msg


def capture(client, agent, trace, **kw):
    return client.post("/v1/traces", json={"agentId": agent["id"], "trace": trace, "final": True, **kw})


def make_active(client, agent, holdout=0, mode="active"):
    c = client.post("/v1/corrections", json={"agentId": agent["id"], "title": "t", "guidance": "do not offer again",
                                              "trigger": DISCOUNT_TRIGGER}).json()
    client.post(f"/v1/corrections/{c['id']}/preview")
    assert client.post(f"/v1/corrections/{c['id']}/activate", json={"holdout_pct": holdout}).status_code == 200
    client.patch(f"/v1/agents/{agent['id']}", json={"mode": mode})
    return c


def ctx(client, agent, conv="c1", tid="x"):
    return client.post("/v1/context", json={"agentId": agent["id"],
                                            "trace": make_trace(tid, conv, messages=discount_messages())}).json()


def test_healthz_and_index(client):
    assert client.get("/healthz").json() == {"ok": True, "mock": True}
    r = client.get("/")
    assert r.status_code == 200 and "Steer" in r.text


def test_api_key_401(client):
    assert TestClient(client.app).get("/v1/agents").status_code == 401
    assert TestClient(client.app).get("/v1/agents", headers={"X-Steer-Key": "nope"}).status_code == 401
    assert client.get("/v1/agents").status_code == 200


def test_capture_upsert_by_revision(client, agent):
    r = capture(client, agent, make_trace("t1", rev=1, messages=[msg("user", "v1")]))
    assert r.json()["status"] == "accepted" and r.json()["ingestion"]["status"] == "queued"
    capture(client, agent, make_trace("t1", rev=2, messages=[msg("user", "v2")]), outcome={"success": False, "note": "n"})
    assert capture(client, agent, make_trace("t1", rev=1, messages=[msg("user", "old")])).json()["ingestion"]["status"] == "stale"
    t = client.get("/v1/turns/t1").json()
    assert t["revision"] == 2 and t["messages"][0]["content"] == "v2" and t["outcome_success"] is False
    assert len(client.get(f"/v1/agents/{agent['id']}/turns").json()) == 1
    assert len(client.get(f"/v1/agents/{agent['id']}/turns?failed_only=true").json()) == 1


def test_set_outcome_and_judge(client, agent):
    capture(client, agent, make_trace("t2", messages=[msg("user", "this is useless")]))
    assert client.post("/v1/turns/t2/outcome", json={"success": True}).json()["outcome_success"] is True
    capture(client, agent, make_trace("t3", messages=[msg("user", "stop offering me this")]))
    j = client.post("/v1/turns/t3/judge").json()
    assert j["judged"] and j["outcome_success"] is False


def test_invalid_regex_422(client, agent):
    r = client.post("/v1/corrections", json={"agentId": agent["id"], "title": "x", "guidance": "g",
                                              "trigger": {"all": [{"type": "message_matches", "pattern": "("}]}})
    assert r.status_code == 422


def test_activate_409_without_preview_and_after_edit(client, agent):
    c = client.post("/v1/corrections", json={"agentId": agent["id"], "title": "t", "guidance": "g",
                                              "trigger": DISCOUNT_TRIGGER}).json()
    assert client.post(f"/v1/corrections/{c['id']}/activate", json={"holdout_pct": 10}).status_code == 409
    assert client.post(f"/v1/corrections/{c['id']}/preview").status_code == 200
    assert client.get(f"/v1/corrections/{c['id']}").json()["status"] == "previewed"
    p = client.patch(f"/v1/corrections/{c['id']}", json={"guidance": "new"}).json()
    assert p["version"] == 2 and p["status"] == "draft" and p["preview"] is None
    assert client.post(f"/v1/corrections/{c['id']}/activate", json={"holdout_pct": 10}).status_code == 409
    client.post(f"/v1/corrections/{c['id']}/preview")
    assert client.post(f"/v1/corrections/{c['id']}/activate", json={"holdout_pct": 10}).json()["status"] == "active"
    assert client.post(f"/v1/corrections/{c['id']}/pause").json()["status"] == "paused"


def test_context_off_shadow_active(client, agent):
    make_active(client, agent, holdout=0, mode="off")
    r = ctx(client, agent)
    assert r["context"] == "" and r["mode"] == "off"
    client.patch(f"/v1/agents/{agent['id']}", json={"mode": "shadow"})
    r = ctx(client, agent)
    assert r["context"] == "" and r["mode"] == "shadow" and r["corrections"] == []
    client.patch(f"/v1/agents/{agent['id']}", json={"mode": "active"})
    r = ctx(client, agent)
    assert r["context"].startswith("Guidance for this situation:\n- do not offer again")
    assert len(r["corrections"]) == 1 and r["delivery"] == "accepted"


def test_shadow_records_delivery_not_delivered(client, agent):
    c = make_active(client, agent, holdout=0, mode="shadow")
    ctx(client, agent)
    rows = client.app.state.db.list_deliveries(c["id"])
    assert len(rows) == 1 and rows[0]["delivered"] == 0 and rows[0]["mode"] == "shadow"


def test_no_match_no_delivery_row(client, agent):
    c = make_active(client, agent)
    client.post("/v1/context", json={"agentId": agent["id"], "trace": make_trace("z", messages=[msg("user", "hi")])})
    assert client.app.state.db.list_deliveries(c["id"]) == []


def test_holdout_conversations_get_nothing(client, agent):
    c = make_active(client, agent, holdout=100)
    r = ctx(client, agent)
    assert r["context"] == ""
    rows = client.app.state.db.list_deliveries(c["id"])
    assert rows[0]["group_name"] == "holdout" and rows[0]["delivered"] == 0


def test_mistakes_endpoint_empty_and_404(client, agent):
    assert client.get(f"/v1/agents/{agent['id']}/mistakes").json() == []
    assert client.get("/v1/agents/nope").status_code == 404
