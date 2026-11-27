from slack_sdk import WebClient

from conftest import XOXB


def api(env_id, method):
    return f"/e/{env_id}/slack/api/{method}"


def setup_channel(live, env_id):
    live.http.post(f"/_sim/envs/{env_id}/seed", json={
        "slack.channels": {"C0TEST0001": {"name": "support"}},
        "slack.users": {"U0A": {"name": "ann", "profile": {"email": "ann@x.co"}}}})


def test_auth_error_shape(live, env_id):
    r = live.http.post(api(env_id, "auth.test"))
    assert r.status_code == 200 and r.json() == {"ok": False, "error": "not_authed"}
    r = live.http.post(api(env_id, "auth.test"), headers={"Authorization": "Bearer nope"})
    assert r.json() == {"ok": False, "error": "invalid_auth"}


def test_post_history_replies_form_and_json(live, env_id):
    setup_channel(live, env_id)
    a = live.http.post(api(env_id, "chat.postMessage"), data={"channel": "C0TEST0001", "text": "hello"}, headers=XOXB).json()
    assert a["ok"] and a["ts"].count(".") == 1 and len(a["ts"].split(".")[1]) == 6
    b = live.http.post(api(env_id, "chat.postMessage"), json={"channel": "#support", "text": "reply", "thread_ts": a["ts"]},
                       headers=XOXB).json()
    assert b["ok"] and b["message"]["thread_ts"] == a["ts"]
    hist = live.http.post(api(env_id, "conversations.history"), data={"channel": "C0TEST0001"}, headers=XOXB).json()
    assert [m["text"] for m in hist["messages"]] == ["hello"]  # thread replies are not top-level
    rep = live.http.post(api(env_id, "conversations.replies"), data={"channel": "C0TEST0001", "ts": a["ts"]}, headers=XOXB).json()
    assert [m["text"] for m in rep["messages"]] == ["hello", "reply"]
    events = live.http.get(f"/_sim/envs/{env_id}/egress").json()["events"]
    assert [e["type"] for e in events] == ["slack.message_posted"] * 2


def test_errors_are_http_200(live, env_id):
    r = live.http.post(api(env_id, "chat.postMessage"), data={"channel": "C0NOPE", "text": "x"}, headers=XOXB)
    assert r.status_code == 200 and r.json() == {"ok": False, "error": "channel_not_found"}


def test_update_delete_react_users(live, env_id):
    setup_channel(live, env_id)
    ts = live.http.post(api(env_id, "chat.postMessage"), data={"channel": "C0TEST0001", "text": "v1"}, headers=XOXB).json()["ts"]
    up = live.http.post(api(env_id, "chat.update"), data={"channel": "C0TEST0001", "ts": ts, "text": "v2"}, headers=XOXB).json()
    assert up["ok"] and up["text"] == "v2"
    rx = {"channel": "C0TEST0001", "timestamp": ts, "name": "eyes"}
    assert live.http.post(api(env_id, "reactions.add"), data=rx, headers=XOXB).json()["ok"]
    assert live.http.post(api(env_id, "reactions.add"), data=rx, headers=XOXB).json()["error"] == "already_reacted"
    u = live.http.post(api(env_id, "users.lookupByEmail"), data={"email": "ann@x.co"}, headers=XOXB).json()
    assert u["user"]["id"] == "U0A"
    assert live.http.post(api(env_id, "users.info"), data={"user": "U0Z"}, headers=XOXB).json()["error"] == "user_not_found"
    assert live.http.post(api(env_id, "chat.delete"), data={"channel": "C0TEST0001", "ts": ts}, headers=XOXB).json()["ok"]
    assert live.http.post(api(env_id, "chat.delete"), data={"channel": "C0TEST0001", "ts": ts}, headers=XOXB).json()["error"] == "message_not_found"


def test_create_channel_ids(live, env_id):
    r = live.http.post(api(env_id, "conversations.create"), data={"name": "ops"}, headers=XOXB).json()
    cid = r["channel"]["id"]
    assert cid[0] == "C" and len(cid) == 11 and cid == cid.upper()
    assert live.http.post(api(env_id, "conversations.create"), data={"name": "ops"}, headers=XOXB).json()["error"] == "name_taken"


def test_sdk_webclient_post_and_read(live, env_id):
    setup_channel(live, env_id)
    wc = WebClient(token="xoxb-placeholder", base_url=f"{live.base}/e/{env_id}/slack/api/")
    assert wc.auth_test()["ok"]
    res = wc.chat_postMessage(channel="C0TEST0001", text="from sdk")
    hist = wc.conversations_history(channel="C0TEST0001")
    assert [m["text"] for m in hist["messages"]] == ["from sdk"] and res["ts"] == hist["messages"][0]["ts"]
