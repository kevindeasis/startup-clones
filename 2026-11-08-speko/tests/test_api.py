import base64

LANGS = ["en", "es", "de", "hi", "ja"]


def test_a1_dashboard_boots(client):
    r = client.get("/")
    assert r.status_code == 200 and "Speko-lite" in r.text
    assert client.get("/api/health").json()["mock_mode"] is True


def test_a2_benchmarks_populated_and_wer(client):
    run = client.post("/api/benchmarks/run", json={}).json()
    assert run["rows_inserted"] == 9 * 5
    rows = client.get("/api/benchmarks").json()["results"]
    assert len(rows) == 45
    assert {r["language"] for r in rows} == set(LANGS)
    for lang in LANGS:
        stt = client.get(f"/api/benchmarks?stage=stt&language={lang}").json()["results"]
        assert len(stt) == 3
        wers = [r["wer"] for r in stt]
        assert all(0 <= w <= 1 for w in wers) and len(set(wers)) == 3
        assert [r["rank"] for r in stt] == [1, 2, 3]
        assert all(r["n_samples"] == 6 for r in stt)
    hi = client.get("/api/benchmarks?stage=stt&language=hi").json()["results"]
    assert hi[0]["wer"] <= hi[1]["wer"] <= hi[2]["wer"]


def test_a2_partial_run(client):
    r = client.post("/api/benchmarks/run", json={"languages": ["en"], "stages": ["tts"]}).json()
    assert r["rows_inserted"] == 3


def test_a3_routing(client):
    def route(lang, pri, stage="stt", uc="general"):
        return client.post("/api/route", json={"stage": stage, "language": lang, "priority": pri, "use_case": uc}).json()
    en, hi = route("en", "quality"), route("hi", "quality")
    assert en["selected"] == "mock-stt-alpha" and hi["selected"] == "mock-stt-beta"
    assert en["selected"] != hi["selected"]
    for lang in LANGS:
        for stage in ("stt", "llm", "tts"):
            r = route(lang, "cost", stage)
            rows = client.get(f"/api/benchmarks?stage={stage}&language={lang}").json()["results"]
            cheapest = min(rows, key=lambda x: x["cost_usd"])["provider"]
            assert r["selected"] == cheapest, (stage, lang)
    assert route("en", "latency")["selected"] == "mock-stt-alpha"
    b = en["ranked"][0]["breakdown"]
    assert set(b) >= {"quality", "latency", "cost"} and abs(sum(en["weights"].values()) - 1) < 1e-3


def test_a3_use_case_changes_weights(client):
    sup = client.post("/api/route", json={"stage": "llm", "language": "en", "use_case": "support_call", "priority": "quality"}).json()
    rt = client.post("/api/route", json={"stage": "llm", "language": "en", "use_case": "realtime_voice", "priority": "latency"}).json()
    assert sup["weights"]["quality"] > rt["weights"]["quality"] and rt["weights"]["latency"] > sup["weights"]["latency"]
    assert sup["selected"] == "mock-llm-smart" and rt["selected"] == "mock-llm-fast"


def test_a4_text_turn(client):
    r = client.post("/api/turn", data={"text": "please book a table", "language": "en", "use_case": "general", "priority": "quality"})
    assert r.status_code == 200
    d = r.json()
    assert d["transcript"] and d["reply"]
    wav = base64.b64decode(d["audio_base64"])
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert [t["stage"] for t in d["trace"]] == ["stt", "llm", "tts"]
    for t in d["trace"]:
        assert t["provider"] and t["latency_ms"] > 0 and t["cost_usd"] >= 0 and t["attempts"][-1]["ok"]
    assert client.get("/api/turns").json()["turns"][0]["transcript"] == d["transcript"]


def test_a4_audio_turn(client):
    wav = client.get("/api/eval-audio?language=en&idx=0").content
    r = client.post("/api/turn", data={"language": "en", "priority": "quality"}, files={"audio": ("a.wav", wav, "audio/wav")})
    assert r.status_code == 200 and "book a table" in r.json()["transcript"]


def test_a5_failover_and_breaker(client):
    chosen = client.post("/api/route", json={"stage": "stt", "language": "en", "priority": "quality"}).json()["selected"]
    assert client.post("/api/admin/fault", json={"provider": chosen, "mode": "fail"}).status_code == 200
    form = {"text": "hello world", "language": "en", "priority": "quality"}
    for i in range(3):
        d = client.post("/api/turn", data=form).json()
        stt = d["trace"][0]
        assert stt["attempts"][0] == {"provider": chosen, "ok": False, "error": stt["attempts"][0]["error"]}
        assert stt["attempts"][1]["ok"] and stt["provider"] != chosen and stt["fallback_used"]
    h = {p["provider"]: p for p in client.get("/api/health").json()["providers"]}
    assert h[chosen]["circuit_open"] and h[chosen]["consecutive_failures"] == 3
    d = client.post("/api/turn", data=form).json()
    assert chosen not in [a["provider"] for a in d["trace"][0]["attempts"]]
    assert chosen in d["trace"][0]["skipped_open_circuit"]
    assert client.post("/api/route", json={"stage": "stt", "language": "en", "priority": "quality"}).json()["selected"] != chosen
    client.post("/api/admin/fault", json={"provider": chosen, "mode": "ok"})
    h = {p["provider"]: p for p in client.get("/api/health").json()["providers"]}
    assert not h[chosen]["circuit_open"]
    assert client.post("/api/turn", data=form).json()["trace"][0]["provider"] == chosen


def test_failover_max_three_then_502(client):
    for p in ("mock-stt-alpha", "mock-stt-beta", "mock-stt-gamma"):
        client.post("/api/admin/fault", json={"provider": p, "mode": "fail"})
    r = client.post("/api/turn", data={"text": "hi", "language": "en"})
    assert r.status_code == 502 and len(r.json()["detail"]["attempts"]) == 3


def test_slow_fault_adds_latency(client):
    base = client.post("/api/turn", data={"text": "hi", "language": "en", "priority": "quality"}).json()
    chosen = base["trace"][0]["provider"]
    client.post("/api/admin/fault", json={"provider": chosen, "mode": "slow"})
    slow = client.post("/api/turn", data={"text": "hi", "language": "en", "priority": "quality"}).json()
    assert slow["trace"][0]["provider"] == chosen and slow["trace"][0]["latency_ms"] > base["trace"][0]["latency_ms"] + 500


def test_a6_validation(client):
    r = client.post("/api/route", json={"stage": "stt", "language": "xx"})
    assert r.status_code == 422 and "Unsupported language" in r.text
    r = client.post("/api/route", json={"stage": "video", "language": "en"})
    assert r.status_code == 422 and "Unknown stage" in r.text
    assert client.get("/api/benchmarks?stage=nope").status_code == 422
    assert client.get("/api/benchmarks?language=zz").status_code == 422
    assert client.post("/api/turn", data={"text": "hi", "language": "zz"}).status_code == 422
    assert client.post("/api/turn", data={"language": "en"}).status_code == 422
    assert client.post("/api/benchmarks/run", json={"languages": ["xx"]}).status_code == 422
    assert client.post("/api/admin/fault", json={"provider": "nope", "mode": "fail"}).status_code == 422


def test_providers_listing(client):
    d = client.get("/api/providers").json()
    names = {p["name"] for p in d["providers"]}
    assert len(names) == 9 and all(p["mock"] for p in d["providers"])


def test_wer_helper_unit():
    import jiwer
    assert jiwer.wer("a b c d", "a b c d") == 0.0
