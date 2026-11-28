import json

from steer.db import Database
from steer.discovery import discover, llm_discover
from steer.llm import AnthropicLLM, MockLLM
from tests.test_llm import FakeClient, Block, Resp
from examples.support_agent import run_batch
from steer_sdk import Steer


def test_mock_discovery_finds_both_demo_mistakes(client, agent):
    s = Steer("http://testserver", "dev", agent["id"], http_client=client)
    run_batch(s, 30, 3, "baseline")
    res = client.post(f"/v1/agents/{agent['id']}/discover", json={}).json()
    titles = " | ".join(m["title"].lower() for m in res["mistakes"])
    assert "discount" in titles and "troubleshooting" in titles
    assert res["source"] == "heuristic"
    assert all(len(m["evidence"]) >= 2 for m in res["mistakes"])
    assert len(client.get(f"/v1/agents/{agent['id']}/mistakes").json()) == len(res["mistakes"])
    # rerun replaces
    client.post(f"/v1/agents/{agent['id']}/discover", json={})
    assert len(client.get(f"/v1/agents/{agent['id']}/mistakes").json()) == len(res["mistakes"])


def _db_with_turns(n=4):
    db = Database(":memory:")
    a = db.create_agent("a")
    for i in range(n):
        db.upsert_turn(a["id"], {"id": f"t{i}", "conversationId": f"c{i}", "conversationRevision": 1,
                                 "messages": [{"role": "user", "content": f"problem {i}"}]},
                       True, "completed", {"success": False})
    return db, a


PAYLOAD = {"mistakes": [
    {"title": "M1", "description": "d", "evidence": [1, 2, 99], "suggested_guidance": "g",
     "suggested_trigger": {"all": [{"type": "tool_called", "name": "x"}]}},
    {"title": "weak", "description": "d", "evidence": [1], "suggested_guidance": "g", "suggested_trigger": {}},
    {"title": "BadTrig", "description": "d", "evidence": [3, 4], "suggested_guidance": "g",
     "suggested_trigger": {"all": [{"type": "message_matches", "pattern": "("}]}}]}


def test_llm_discovery_parses_fenced_json():
    db, a = _db_with_turns()
    text = "Here you go:\n```json\n" + json.dumps(PAYLOAD) + "\n```"
    llm = AnthropicLLM(FakeClient(text))
    res = discover(db, llm, a["id"])
    assert res["source"] == "llm"
    titles = [m["title"] for m in res["mistakes"]]
    assert titles == ["M1", "BadTrig"]  # < 2 valid evidence dropped
    assert len(res["mistakes"][0]["evidence"]) == 2  # out-of-range turn number dropped
    assert res["mistakes"][1]["suggested_trigger"]["situation"]  # invalid trigger -> situation-only


def test_llm_discovery_failure_falls_back():
    db, a = _db_with_turns()
    llm = AnthropicLLM(FakeClient("not json at all", stop_reason="max_tokens"))
    res = discover(db, llm, a["id"])
    assert res["source"] == "heuristic" and "failed" in res["note"]
    llm = AnthropicLLM(FakeClient("", stop_reason="refusal"))
    assert discover(db, llm, a["id"])["source"] == "heuristic"
