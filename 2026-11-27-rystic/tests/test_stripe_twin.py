import stripe

from conftest import SK


def S(live, env_id, path):
    return f"/e/{env_id}/stripe/v1{path}"


def test_customer_roundtrip_and_error_shape(live, env_id):
    r = live.http.post(S(live, env_id, "/customers"), data={"email": "a@b.co", "name": "A"}, headers=SK)
    assert r.status_code == 200
    c = r.json()
    assert c["id"].startswith("cus_") and len(c["id"]) == 4 + 14 and c["object"] == "customer"
    g = live.http.get(S(live, env_id, f"/customers/{c['id']}"), headers=SK)
    assert g.json()["email"] == "a@b.co"
    bad = live.http.get(S(live, env_id, "/customers/cus_nope"), headers=SK)
    assert bad.status_code == 404
    assert bad.json() == {"error": {"type": "invalid_request_error", "code": "resource_missing",
                                    "message": "No such customer: 'cus_nope'", "param": "id"}}


def test_auth_required(live, env_id):
    r = live.http.get(S(live, env_id, "/customers"))
    assert r.status_code == 401 and r.json()["error"]["type"] == "invalid_request_error"
    r = live.http.get(S(live, env_id, "/customers"), headers={"Authorization": "Bearer pk_live_x"})
    assert r.status_code == 401


def test_list_filter_search_delete(live, env_id):
    for e in ("x@a.co", "y@a.co"):
        live.http.post(S(live, env_id, "/customers"), data={"email": e}, headers=SK)
    lst = live.http.get(S(live, env_id, "/customers"), headers=SK).json()
    assert lst["object"] == "list" and len(lst["data"]) == 2 and lst["has_more"] is False
    assert lst["url"] == "/v1/customers"
    by = live.http.get(S(live, env_id, "/customers"), params={"email": "y@a.co"}, headers=SK).json()
    assert [c["email"] for c in by["data"]] == ["y@a.co"]
    s = live.http.get(S(live, env_id, "/customers/search"), params={"query": "email:'x@a.co'"}, headers=SK).json()
    assert len(s["data"]) == 1
    cid = s["data"][0]["id"]
    d = live.http.delete(S(live, env_id, f"/customers/{cid}"), headers=SK).json()
    assert d["deleted"] is True
    assert live.http.get(S(live, env_id, f"/customers/{cid}"), headers=SK).status_code == 404


def test_payment_intent_confirm_creates_charge_and_refund(live, env_id):
    pi = live.http.post(S(live, env_id, "/payment_intents"), data={"amount": "2500", "currency": "usd"}, headers=SK).json()
    assert pi["status"] == "requires_confirmation"
    done = live.http.post(S(live, env_id, f"/payment_intents/{pi['id']}/confirm"), headers=SK).json()
    assert done["status"] == "succeeded"
    ch = live.http.get(S(live, env_id, f"/charges/{done['latest_charge']}"), headers=SK).json()
    assert ch["amount"] == 2500 and ch["status"] == "succeeded"
    rf = live.http.post(S(live, env_id, "/refunds"), data={"payment_intent": pi["id"], "amount": "1000"}, headers=SK).json()
    assert rf["id"].startswith("re_") and rf["amount"] == 1000
    ch = live.http.get(S(live, env_id, f"/charges/{ch['id']}"), headers=SK).json()
    assert ch["amount_refunded"] == 1000 and ch["refunded"] is False
    events = live.http.get(f"/_sim/envs/{env_id}/egress").json()["events"]
    types = [e["type"] for e in events]
    assert {"payment_intent.succeeded", "charge.succeeded", "refund.created", "charge.refunded"} <= set(types)


def test_missing_param_error(live, env_id):
    r = live.http.post(S(live, env_id, "/payment_intents"), data={"currency": "usd"}, headers=SK)
    assert r.status_code == 400 and r.json()["error"]["code"] == "parameter_missing"


def test_over_refund_rejected(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json={"stripe.charges": {"ch_a": {"amount": 1000}}})
    ok = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_a"}, headers=SK)
    assert ok.status_code == 200 and ok.json()["amount"] == 1000
    again = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_a"}, headers=SK)
    assert again.status_code == 400 and again.json()["error"]["code"] == "charge_already_refunded"


def test_idempotency_replay(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json={"stripe.charges": {"ch_a": {"amount": 1000}}})
    h = {**SK, "Idempotency-Key": "k1"}
    a = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_a"}, headers=h)
    b = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_a"}, headers=h)
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert b.headers.get("idempotent-replayed") == "true"
    refunds = live.http.get(S(live, env_id, "/refunds"), headers=SK).json()["data"]
    assert len(refunds) == 1


def test_sdk_stripe_customer_and_refund(live, env_id):
    client = stripe.StripeClient("sk_test_placeholder", base_addresses={"api": f"{live.base}/e/{env_id}/stripe"})
    cust = client.v1.customers.create(params={"email": "sdk@example.com", "metadata": {"k": "v"}})
    assert cust.id.startswith("cus_") and cust.metadata["k"] == "v"
    live.http.post(f"/_sim/envs/{env_id}/seed", json={"stripe.charges": {"ch_sdk": {"amount": 700, "customer": cust.id}}})
    ref = client.v1.refunds.create(params={"charge": "ch_sdk"})
    assert ref.object == "refund" and ref.amount == 700
    try:
        client.v1.customers.retrieve("cus_missing")
        raise AssertionError("expected InvalidRequestError")
    except stripe.InvalidRequestError as exc:
        assert exc.code == "resource_missing" and exc.http_status == 404


def test_partial_refunds_within_total_accepted_then_over_refund_rejected(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json={"stripe.charges": {"ch_p": {"amount": 9800}}})
    for _ in range(2):
        r = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_p", "amount": "4900"}, headers=SK)
        assert r.status_code == 200
    ch = live.http.get(S(live, env_id, "/charges/ch_p"), headers=SK).json()
    assert ch["amount_refunded"] == 9800 and ch["refunded"] is True
    over = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_p", "amount": "1"}, headers=SK)
    assert over.status_code == 400 and over.json()["error"]["code"] == "charge_already_refunded"
    full = live.http.post(S(live, env_id, "/refunds"), data={"charge": "ch_p"}, headers=SK)
    assert full.status_code == 400 and full.json()["error"]["code"] == "charge_already_refunded"
