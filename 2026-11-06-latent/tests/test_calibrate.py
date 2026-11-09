from app.calibrate import calibrate


def rows(spec):
    return [{"score": s, "review_status": st} for s, st in spec]


def test_calibrate_separates_classes():
    r = calibrate(rows([(0.9, "confirmed"), (0.8, "confirmed"), (0.7, "confirmed"),
                        (0.2, "cleared"), (0.1, "cleared")]))
    assert 0.2 < r["threshold"] <= 0.7
    assert r["precision"] == 1.0 and r["recall"] == 1.0 and r["labeled_count"] == 5


def test_calibrate_endpoint_400_then_ok(client):
    from tests.conftest import BAD, GOOD, SOURCES

    r = client.post("/v1/calibrate")
    assert r.status_code == 400 and "at least 5" in r.json()["detail"]
    for i in range(6):
        ans = BAD if i % 2 == 0 else GOOD
        body = {"prompt": "q", "answer": ans, "sources": SOURCES, "policy": "deliver"}
        sid = client.post("/v1/score", json=body).json()["id"]
        client.post("/v1/reviews", json={"id": sid, "decision": "confirmed" if i % 2 == 0 else "cleared"})
    r = client.post("/v1/calibrate")
    assert r.status_code == 200
    assert 0.05 <= r.json()["threshold"] <= 0.95 and r.json()["labeled_count"] == 6
    assert client.get("/v1/stats").json()["threshold"] == r.json()["threshold"]
