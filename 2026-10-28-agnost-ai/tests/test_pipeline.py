import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import db
from app.llm import AnthropicLLM, MockLLM, extract_json
from app.main import app

HINTS = {"rephrase_count": 0, "caps_ratio": 0.0, "exclamation_count": 0, "profanity_hit": False, "user_message_count": 1, "ended_on_user_turn": False}


def conv(cid, uid, turns):
    return [{"conversation_id": cid, "user_id": uid, "role": r, "content": t} for r, t in turns]


SUB = lambda cid, uid, q: conv(cid, uid, [("user", q), ("assistant", "Sorry, I can't generate subtitles automatically yet."), ("user", "ok thanks")])


def six_conversations():
    m = []
    m += SUB("c1", "u1", "Can you add automatic subtitles to my clip?")
    m += SUB("c2", "u2", "I wish it could generate captions automatically")
    m += SUB("c3", "u3", "Is there a way to auto-generate subtitles for this video?")
    m += conv("c4", "u4", [("user", "My export keeps failing with an error"), ("assistant", "Sorry, try again."), ("user", "ok")])
    m += conv("c5", "u5", [("user", "Trim the first 5 seconds"), ("assistant", "Done!"), ("user", "Thanks, perfect")])
    m += conv("c6", "u6", [("user", "Add music to my clip"), ("assistant", "Done, here you go."), ("user", "THIS IS USELESS!! NOTHING CHANGED")])
    return m


@pytest.fixture
def client(tmp_path):
    db.init_engine(f"sqlite:///{tmp_path / 't.db'}")
    app.state.llm = MockLLM()
    yield TestClient(app)


def test_healthz_mock(client):
    assert client.get("/healthz").json() == {"ok": True, "llm": "mock"}


def test_end_to_end_six_conversations(client):
    r = client.post("/api/v1/conversations", json={"messages": six_conversations()})
    assert r.json() == {"ingested": 18, "conversations": 6}
    assert client.post("/api/v1/analyze").json() == {"analyzed": 6, "skipped": 0, "model": "mock"}
    assert client.post("/api/v1/analyze").json()["analyzed"] == 0  # idempotent
    assert client.post("/api/v1/analyze?force=true").json()["analyzed"] == 6
    cl = client.post("/api/v1/cluster").json()
    assert cl["feature_groups"] == 1 and cl["bug_groups"] == 1 and cl["patterns"] >= 3

    stats = client.get("/api/v1/stats").json()
    assert (stats["conversations"], stats["users"], stats["analyzed"]) == (6, 6, 6)
    assert stats["signal_rates"]["feature_request"] == 50.0

    pats = client.get("/api/v1/patterns").json()["patterns"]
    fr = next(p for p in pats if p["kind"] == "feature_requests")
    assert fr["conversation_count"] == 3 and fr["user_count"] == 3

    for path in ["/", "/patterns", "/patterns/custom", f"/patterns/{fr['id']}", "/feature-requests", "/bugs",
                 "/conversations", "/conversations/c1", "/conversations?signal=feature_request", "/conversations?q=export"]:
        assert client.get(path).status_code == 200, path
    assert "Feature requests" in client.get("/").text
    assert "auto-generate subtitles" in client.get("/feature-requests").text
    assert "Can you add automatic subtitles" in client.get("/conversations/c1").text
    assert client.get("/conversations/nope").status_code == 404
    csv_text = client.get("/api/v1/export/feature-requests.csv").text
    assert "auto-generate subtitles,3,3" in csv_text

    d = client.get("/api/v1/conversations/c6").json()
    assert d["analysis"]["has_frustration"] is True and d["has_frustration"] is True
    assert len(d["messages"]) == 3
    assert client.get("/api/v1/conversations?signal=frustration").json()["total"] == 1


def test_new_conversation_increments_analyzed_by_one(client):
    client.post("/api/v1/conversations", json={"messages": six_conversations()})
    client.post("/api/v1/analyze")
    client.post("/api/v1/conversations", json={"messages": conv("new1", "u9", [
        ("user", "Do you support dark mode?"), ("assistant", "No, we don't support dark mode yet."),
        ("user", "ok"), ("assistant", "Sorry!")])})
    assert client.post("/api/v1/analyze").json()["analyzed"] == 1
    assert client.get("/api/v1/conversations/new1").json()["analysis"]["has_feature_request"] is True


def test_ingest_appends_and_upserts(client):
    client.post("/api/v1/conversations", json={"messages": conv("x", "u1", [("user", "hi")])})
    client.post("/api/v1/conversations", json={"messages": conv("x", None, [("assistant", "hello")])})
    d = client.get("/api/v1/conversations/x").json()
    assert d["message_count"] == 2 and d["user_id"] == "u1" and [m["idx"] for m in d["messages"]] == [0, 1]


def test_ingest_rejects_bad_role(client):
    r = client.post("/api/v1/conversations", json={"messages": conv("x", "u", [("robot", "hi")])})
    assert r.status_code == 422


def test_custom_pattern_and_reapply(client):
    client.post("/api/v1/conversations", json={"messages": six_conversations()})
    client.post("/api/v1/analyze")
    r = client.post("/api/v1/patterns/custom", json={"name": "Subtitle asks", "description": "User asks for automatic subtitles or captions"})
    assert r.status_code == 200
    p = r.json()
    assert p["kind"] == "custom" and len(p["members"]) >= 3
    # re-applied to new conversations on analyze
    client.post("/api/v1/conversations", json={"messages": SUB("c7", "u7", "Can you add automatic captions to my reel?")})
    client.post("/api/v1/analyze")
    p2 = client.get(f"/api/v1/patterns/{p['id']}").json()
    assert len(p2["members"]) == len(p["members"]) + 1
    # form flow
    r = client.post("/patterns/custom", data={"name": "Bugs-ish", "description": "export error"}, follow_redirects=False)
    assert r.status_code == 303


def test_mock_hallucination_and_churn():
    llm = MockLLM()
    turns = [{"role": "user", "content": "Where are the docs?"},
             {"role": "assistant", "content": "See https://example.com/docs/x"},
             {"role": "user", "content": "That link gives a 404"}]
    res, model = asyncio.run(llm.analyze_conversation("P", HINTS, turns))
    assert res.signals.hallucination_suspected and model == "mock" and not res.bug_reports
    res, _ = asyncio.run(llm.analyze_conversation("P", HINTS, [{"role": "user", "content": "I want a refund"}]))
    assert res.signals.churn_signal and res.outcome == "abandoned"


# ------------------------------------------------------------ Anthropic path (monkeypatched SDK)
CANNED = {
    "summary": "User wanted subtitles; assistant could not.", "intent": "add subtitles to a clip", "outcome": "unresolved",
    "sentiment": "neutral", "frustration_score": 0.2,
    "signals": {"frustration": False, "repeated_rephrasing": False, "correction": False,
                "hallucination_suspected": False, "churn_signal": False, "silent_failure": False},
    "feature_requests": ["auto subtitles"], "bug_reports": [], "evidence": ["can you add subtitles"],
}


class FakeMessages:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    async def create(self, **kw):
        self.calls.append(kw)
        text = self.replies.pop(0)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


class FakeAnthropic:
    replies: list = []
    last = None

    def __init__(self, api_key=None, **kw):
        self.api_key = api_key
        self.messages = FakeMessages(type(self).replies)
        type(self).last = self


def test_anthropic_path_parses_fenced_json(monkeypatch):
    import anthropic
    FakeAnthropic.replies = ["Here you go:\n```json\n" + json.dumps(CANNED) + "\n```"]
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeAnthropic)
    llm = AnthropicLLM("test-key", "claude-sonnet-5-5")
    turns = [{"role": "user", "content": "can you add subtitles"}, {"role": "assistant", "content": "I can't"}]
    res, model = asyncio.run(llm.analyze_conversation("ClipPilot", HINTS, turns))
    assert model == "claude-sonnet-5-5" and res.intent == "add subtitles to a clip" and res.feature_requests == ["auto subtitles"]
    call = FakeAnthropic.last.messages.calls[0]
    assert call["max_tokens"] == 800 and call["temperature"] == 0 and call["model"] == "claude-sonnet-5-5"
    assert "ClipPilot" in call["messages"][0]["content"] and "product analyst" in call["system"]


def test_anthropic_retry_then_error_fallback(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeAnthropic)
    FakeAnthropic.replies = ["not json", json.dumps(CANNED)]
    llm = AnthropicLLM("k")
    res, model = asyncio.run(llm.analyze_conversation("P", HINTS, [{"role": "user", "content": "x"}]))
    assert model == "claude-sonnet-5-5" and len(FakeAnthropic.last.messages.calls) == 2
    assert "invalid" in FakeAnthropic.last.messages.calls[1]["messages"][0]["content"]
    FakeAnthropic.replies = ["nope", '{"summary": 1}']
    llm = AnthropicLLM("k")
    res, model = asyncio.run(llm.analyze_conversation("P", HINTS, [{"role": "user", "content": "x"}]))
    assert model == "error" and res.intent == "unparsed" and res.outcome == "unresolved"


def test_anthropic_cluster_and_classify(monkeypatch):
    import anthropic
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeAnthropic)
    FakeAnthropic.replies = ['{"name": "Subtitle requests", "description": "Users want subtitles."}']
    llm = AnthropicLLM("k")
    nm = asyncio.run(llm.name_cluster(["subtitles", "auto"], ["add subtitles"]))
    assert nm.name == "Subtitle requests"
    items = [{"summary": "s", "intent": "i", "last_turns": ["user: a"]} for _ in range(12)]
    FakeAnthropic.replies = [json.dumps([{"match": True, "confidence": 0.9, "reason": "r"}] * 10),
                             json.dumps([{"match": False, "confidence": 0.1, "reason": "r"}] * 2)]
    llm = AnthropicLLM("k")
    res = asyncio.run(llm.classify_custom("n", "d", items))
    assert len(res) == 12 and sum(r.match for r in res) == 10 and len(FakeAnthropic.last.messages.calls) == 2


def test_extract_json_tolerant():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('blah {"a": {"b": 2}} trailing') == {"a": {"b": 2}}
    with pytest.raises(ValueError):
        extract_json("no json here")
