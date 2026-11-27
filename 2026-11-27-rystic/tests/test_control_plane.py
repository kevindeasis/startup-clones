import pytest

from conftest import SK, XOXB


def test_health_version_ui_scenarios(live):
    assert live.http.get("/healthz").status_code == 200
    assert live.http.get("/_sim/version").json()["twins"] == ["stripe", "slack", "github"]
    ui = live.http.get("/")
    assert ui.status_code == 200 and "<title>Rehearsal</title>" in ui.text
    names = [s["name"] for s in live.http.get("/_sim/scenarios").json()["scenarios"]]
    assert {"refund_happy_path", "refund_flaky_network", "refund_flaky_network_idempotent", "github_triage"} <= set(names)


def test_env_create_list_delete_and_unknown_env(live):
    eid = live.env()
    assert eid in [e["env_id"] for e in live.http.get("/_sim/envs").json()["envs"]]
    assert live.http.delete(f"/_sim/envs/{eid}").status_code == 204
    assert live.http.get(f"/_sim/envs/{eid}/inspect").status_code == 404
    assert live.http.get(f"/e/{eid}/stripe/v1/customers", headers=SK).status_code == 404


def test_envs_are_isolated(live):
    a, b = live.env(), live.env()
    live.http.post(f"/e/{a}/stripe/v1/customers", data={"email": "only-a@x.co"}, headers=SK)
    assert live.http.get(f"/e/{b}/stripe/v1/customers", headers=SK).json()["data"] == []


def test_seed_invalid_returns_400_and_writes_nothing(live, env_id):
    bad = {"stripe.customers": {"cus_ok": {"email": "ok@x.co"}}, "stripe.charges": {"ch_bad": {"amount": "lots"}}}
    r = live.http.post(f"/_sim/envs/{env_id}/seed", json=bad)
    assert r.status_code == 400
    assert live.http.get(f"/_sim/envs/{env_id}/inspect").json()["registers"] == {}
    assert live.http.post(f"/_sim/envs/{env_id}/seed", json={"nope.register": {}}).status_code == 400
    assert live.http.post(f"/_sim/envs/{env_id}/seed", json={"slack.messages": {"nocolon": {"text": "x"}}}).status_code == 400


def test_clock_pinning_and_advance(live, env_id):
    r = live.http.post(f"/_sim/envs/{env_id}/clock", json={"time": "2026-01-02T03:04:05Z"})
    assert r.json()["time"] == "2026-01-02T03:04:05Z"
    c = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "t@x.co"}, headers=SK).json()
    assert c["created"] == 1767323045
    live.http.post(f"/_sim/envs/{env_id}/clock", json={"advance_seconds": 60})
    c2 = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "t2@x.co"}, headers=SK).json()
    assert c2["created"] == 1767323105
    ts = live.http.post(f"/e/{env_id}/slack/api/conversations.create", data={"name": "c"}, headers=XOXB).json()
    assert ts["ok"] and ts["channel"]["created"] == 1767323105
    assert live.http.post(f"/_sim/envs/{env_id}/clock", json={"time": "not a time"}).status_code == 400


def test_ids_are_deterministic_from_rng_seed(live):
    ids = []
    for _ in range(2):
        eid = live.env()
        live.http.post(f"/_sim/envs/{eid}/reset", json={})
        ids.append(live.http.post(f"/e/{eid}/stripe/v1/customers", data={"email": "d@x.co"}, headers=SK).json()["id"])
    assert ids[0] == ids[1]  # default rng_seed 0 -> same first id


def test_ledger_and_inspect(live, env_id):
    live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "l@x.co"}, headers=SK)
    live.http.get(f"/e/{env_id}/stripe/v1/customers", headers=SK)
    calls = live.http.get(f"/_sim/envs/{env_id}/calls").json()["calls"]
    assert [(c["seq"], c["method"], c["path"], c["status"]) for c in calls] == [
        (1, "POST", "/v1/customers", 200), (2, "GET", "/v1/customers", 200)]
    assert calls[0]["mutations"][0].startswith("stripe.customers:cus_") and calls[1]["mutations"] == []
    assert len(calls[0]["request_digest"]) == 16 and calls[0]["fault"] is None
    assert len(live.http.get(f"/_sim/envs/{env_id}/calls", params={"tail": 1}).json()["calls"]) == 1
    one = live.http.get(f"/_sim/envs/{env_id}/inspect", params={"register": "stripe.customers"}).json()
    assert list(one["registers"]) == ["stripe.customers"] and "clock" in one and "sequences" in one


def test_snapshot_restore(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/clock", json={"time": "2026-05-05T00:00:00Z"})
    live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "one@x.co"}, headers=SK)
    live.http.post(f"/_sim/envs/{env_id}/network", json={"enabled": True, "latency_ms": 1})
    sid = live.http.post(f"/_sim/envs/{env_id}/snapshot").json()["snapshot_id"]
    live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "two@x.co"}, headers=SK)
    live.http.post(f"/_sim/envs/{env_id}/clock", json={"advance_seconds": 999})
    live.http.post(f"/_sim/envs/{env_id}/network", json={"enabled": False})
    assert live.http.post(f"/_sim/envs/{env_id}/restore", json={"snapshot_id": sid}).status_code == 204
    insp = live.http.get(f"/_sim/envs/{env_id}/inspect").json()
    assert len(insp["registers"]["stripe.customers"]) == 1
    assert insp["clock"]["now"] == "2026-05-05T00:00:00Z"
    assert live.http.get(f"/_sim/envs/{env_id}/network").json()["latency_ms"] == 1
    assert len(live.http.get(f"/_sim/envs/{env_id}/calls").json()["calls"]) == 1
    nxt = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "three@x.co"}, headers=SK).json()
    assert nxt["id"] != "" and len(live.http.get(f"/_sim/envs/{env_id}/inspect").json()["registers"]["stripe.customers"]) == 2
    assert live.http.post(f"/_sim/envs/{env_id}/restore", json={"snapshot_id": "snap_nope"}).status_code == 404


def test_scenario_load_and_reset_to_boot(live):
    eid = live.env(scenario="refund_happy_path")
    regs = live.http.get(f"/_sim/envs/{eid}/inspect").json()["registers"]
    assert "cus_seedAcme001" in regs["stripe.customers"]
    live.http.post(f"/e/{eid}/stripe/v1/refunds", data={"charge": "ch_seedAcme001"}, headers=SK)
    live.http.post(f"/_sim/envs/{eid}/reset", json={"to": "boot"})
    insp = live.http.get(f"/_sim/envs/{eid}/inspect").json()
    assert insp["registers"]["stripe.refunds"] == {} if "stripe.refunds" in insp["registers"] else True
    assert insp["registers"]["stripe.charges"]["ch_seedAcme001"]["amount_refunded"] == 0
    live.http.post(f"/_sim/envs/{eid}/reset", json={})
    assert live.http.get(f"/_sim/envs/{eid}/inspect").json()["registers"] == {}
    assert live.http.post(f"/_sim/envs/{eid}/scenario", json={"name": "nope"}).status_code == 404
    assert live.http.post(f"/_sim/envs/{eid}/scenario", json={"name": "github_triage"}).status_code == 204
