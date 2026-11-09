import json

from tests.conftest import BAD, GOOD, SOURCES


def score(client, answer, policy="hold", sources=SOURCES):
    r = client.post("/v1/score", json={"prompt": "What was Q3 revenue?", "answer": answer,
                                       "sources": sources, "policy": policy})
    assert r.status_code == 200, r.text
    return r.json()


def test_hold_policy(client):
    d = score(client, BAD, "hold")
    assert d["flagged"] and d["action"] == "held" and d["final_answer"] == "FALLBACK"
    assert d["failure_type"] in ("unsupported_number", "invented_name")


def test_escalate_policy(client):
    d = score(client, BAD, "escalate")
    assert d["action"] == "escalated"
    assert d["final_answer"] != BAD and "$3.1M" in d["final_answer"] and "4.2" not in d["final_answer"]


def test_deliver_policy(client):
    d = score(client, BAD, "deliver")
    assert d["action"] == "delivered" and d["final_answer"] == BAD


def test_grounded_passes(client):
    d = score(client, GOOD)
    assert not d["flagged"] and d["action"] == "passed" and d["final_answer"] == GOOD


def test_review_updates_stats(client):
    sid = score(client, BAD)["id"]
    assert client.get("/v1/stats").json()["confirmed"] == 0
    assert client.post("/v1/reviews", json={"id": sid, "decision": "confirmed"}).status_code == 200
    s = client.get("/v1/stats").json()
    assert s["confirmed"] == 1 and s["precision"] == 1.0 and s["scored"] == 1
    assert client.post("/v1/reviews", json={"id": "nope", "decision": "cleared"}).status_code == 404


def test_export_only_reviewed(client):
    a, b = score(client, BAD)["id"], score(client, BAD)["id"]
    score(client, GOOD)
    client.post("/v1/reviews", json={"id": a, "decision": "confirmed"})
    client.post("/v1/reviews", json={"id": b, "decision": "cleared"})
    lines = client.get("/v1/export.jsonl").text.strip().splitlines()
    rows = [json.loads(x) for x in lines]
    assert [r["label"] for r in rows] == ["hallucinated", "grounded"]
    assert set(rows[0]) == {"prompt", "answer", "sources", "label", "score", "failure_type", "risky_sentence"}


def test_metrics(client):
    score(client, BAD)
    text = client.get("/metrics").text
    assert "latent_answers_scored_total" in text and "latent_judge_latency_seconds" in text


def test_chat_and_dashboard(client):
    r = client.post("/v1/chat", json={"question": "What was Q3 revenue?", "sources": SOURCES, "policy": "hold"})
    assert r.status_code == 200 and r.json()["raw_answer"] and not r.json()["guarded"]["flagged"]
    r = client.post("/v1/chat", json={"question": "q", "sources": SOURCES, "answer_override": BAD})
    assert r.json()["guarded"]["action"] == "held"
    html = client.get("/")
    assert html.status_code == 200 and "Review queue" in html.text and "<mark>" in html.text
    assert client.get("/?tab=all").status_code == 200


def test_bearer_key_required(client, env):
    env.setenv("LATENT_API_KEY", "secret")
    body = {"prompt": "q", "answer": GOOD, "sources": SOURCES}
    assert client.post("/v1/score", json=body).status_code == 401
    ok = client.post("/v1/score", json=body, headers={"authorization": "Bearer secret"})
    assert ok.status_code == 200


def test_alert_webhook_fails_silently(client, env):
    env.setenv("ALERT_WEBHOOK_URL", "http://127.0.0.1:9/hook")
    for _ in range(6):
        score(client, BAD)
