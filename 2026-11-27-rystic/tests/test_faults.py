import time

from conftest import SK, XOXB


def net(live, env_id, **profile):
    r = live.http.post(f"/_sim/envs/{env_id}/network", json=profile)
    assert r.status_code == 200, r.text


def test_latency_added_and_recorded(live, env_id):
    net(live, env_id, enabled=True, latency_ms=250)
    t0 = time.monotonic()
    r = live.http.get(f"/e/{env_id}/stripe/v1/customers", headers=SK)
    assert r.status_code == 200 and time.monotonic() - t0 >= 0.24
    c = live.http.get(f"/_sim/envs/{env_id}/calls").json()["calls"][0]
    assert c["latency_ms"] == 250 and c["fault"] == "latency"


def test_disabled_profile_has_no_effect(live, env_id):
    net(live, env_id, enabled=False, latency_ms=5000, refuse_fraction=1.0)
    assert live.http.get(f"/e/{env_id}/stripe/v1/customers", headers=SK).status_code == 200


def test_refuse_fraction_all_returns_503_and_touches_no_state(live, env_id):
    net(live, env_id, enabled=True, refuse_fraction=1.0)
    r = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "r@x.co"}, headers=SK)
    assert r.status_code == 503 and r.json()["error"]["type"] == "api_error"
    s = live.http.post(f"/e/{env_id}/slack/api/auth.test", headers=XOXB)
    assert s.status_code == 503 and s.json()["error"] == "service_unavailable"
    assert live.http.get(f"/_sim/envs/{env_id}/inspect").json()["registers"] == {}
    calls = live.http.get(f"/_sim/envs/{env_id}/calls").json()["calls"]
    assert [c["fault"] for c in calls] == ["refused", "refused"]


def test_refuse_fraction_is_deterministic(live):
    runs = []
    for _ in range(2):
        eid = live.env()
        live.http.post(f"/_sim/envs/{eid}/network", json={"enabled": True, "refuse_fraction": 0.5})
        runs.append([live.http.get(f"/e/{eid}/stripe/v1/customers", headers=SK).status_code for _ in range(12)])
    assert runs[0] == runs[1] and 503 in runs[0] and 200 in runs[0]


def test_rate_limit_429_with_retry_after(live, env_id):
    net(live, env_id, enabled=True, rate_limit={"requests_per_minute": 2})
    codes = [live.http.get(f"/e/{env_id}/stripe/v1/customers", headers=SK) for _ in range(3)]
    assert [r.status_code for r in codes] == [200, 200, 429]
    assert int(codes[2].headers["retry-after"]) >= 1
    assert codes[2].json()["error"]["type"] == "rate_limit_error"
    gh = live.http.get(f"/e/{env_id}/github/user", headers={"Authorization": "Bearer ghp_x"})
    assert gh.status_code == 429 and gh.json()["message"] == "API rate limit exceeded"


def test_drop_after_write_applies_mutation_but_client_sees_5xx(live, env_id):
    net(live, env_id, enabled=True, drop_after_write={"service": "stripe", "path_glob": "/v1/customers", "count": 1})
    first = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "d@x.co"}, headers=SK)
    assert first.status_code == 500 and "customer" not in first.text
    custs = live.http.get(f"/_sim/envs/{env_id}/inspect", params={"register": "stripe.customers"}).json()["registers"]
    assert len(custs["stripe.customers"]) == 1  # state changed anyway
    second = live.http.post(f"/e/{env_id}/stripe/v1/customers", data={"email": "d2@x.co"}, headers=SK)
    assert second.status_code == 200  # count exhausted
    faults = [c["fault"] for c in live.http.get(f"/_sim/envs/{env_id}/calls").json()["calls"]]
    assert faults[:2] == ["dropped_after_write", None]
    # reads never count as writes
    net(live, env_id, enabled=True, drop_after_write={"service": "stripe", "path_glob": "*", "count": 5})
    assert live.http.get(f"/e/{env_id}/stripe/v1/customers", headers=SK).status_code == 200


def test_invalid_profile_rejected(live, env_id):
    assert live.http.post(f"/_sim/envs/{env_id}/network", json={"refuse_fraction": 3}).status_code == 400
