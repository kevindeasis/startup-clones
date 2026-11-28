import json

import pytest

from steer.llm import AnthropicLLM, LLMError, LLMRefusal, MockLLM, extract_json
from tests.conftest import discount_messages, make_trace


class Block:
    def __init__(self, text, type="text"):
        self.type, self.text = type, text


class Resp:
    def __init__(self, text, stop_reason="end_turn", blocks=None):
        self.content = blocks if blocks is not None else [Block(text)]
        self.stop_reason = stop_reason


class FakeClient:
    def __init__(self, text="", stop_reason="end_turn", exc=None, blocks=None):
        self.calls, self._r, self._exc = [], Resp(text, stop_reason, blocks), exc
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        if self._exc:
            raise self._exc
        return self._r


def test_extract_json_variants():
    assert extract_json('{"a": 1}') == {"a": 1}
    assert extract_json('```json\n{"a": {"b": 2}}\n```') == {"a": {"b": 2}}
    assert extract_json('Sure! {"a": "x}y"} hope that helps') == {"a": "x}y"}
    with pytest.raises(ValueError):
        extract_json("nothing here")


def test_request_shape_and_first_text_block():
    c = FakeClient(blocks=[Block("", type="thinking"), Block('{"matches": true, "reason": "r"}')])
    llm = AnthropicLLM(c, model="m-test")
    ok, reason = llm.classify(make_trace(messages=discount_messages()), "customer declined", [], timeout=0.5)
    assert ok is True and reason == "r"
    kw = c.calls[0]
    assert kw["model"] == "m-test" and kw["max_tokens"] == 4096 and kw["timeout"] == 0.5
    assert "thinking" not in kw and "temperature" not in kw


def test_default_model(monkeypatch):
    monkeypatch.delenv("STEER_MODEL", raising=False)
    assert AnthropicLLM(FakeClient("{}")).model == "claude-sonnet-5-5"


def test_classifier_yes_no():
    t = make_trace(messages=discount_messages())
    assert AnthropicLLM(FakeClient('{"matches": true, "reason": "y"}')).classify(t, "s", [])[0] is True
    assert AnthropicLLM(FakeClient('```json\n{"matches": false, "reason": "n"}\n```')).classify(t, "s", [])[0] is False


def test_refusal_and_max_tokens():
    t = make_trace(messages=discount_messages())
    with pytest.raises(LLMRefusal):
        AnthropicLLM(FakeClient("", stop_reason="refusal")).classify(t, "s", [])
    with pytest.raises(LLMError, match="max_tokens"):
        AnthropicLLM(FakeClient('{"matches": tr', stop_reason="max_tokens")).classify(t, "s", [])


def test_classifier_timeout_fails_closed_in_context(client, agent):
    from tests.test_api import DISCOUNT_TRIGGER
    client.app.state.llm = AnthropicLLM(FakeClient(exc=TimeoutError("timed out")))
    c = client.post("/v1/corrections", json={"agentId": agent["id"], "title": "s", "guidance": "G",
                                              "trigger": {"all": [], "situation": "customer is upset"}}).json()
    db = client.app.state.db
    db.set_preview(c["id"], {"version": 1, "matched": [], "exclusions": [], "conflicts": [], "counts": {}})
    client.post(f"/v1/corrections/{c['id']}/activate", json={"holdout_pct": 0})
    client.patch(f"/v1/agents/{agent['id']}", json={"mode": "active"})
    r = client.post("/v1/context", json={"agentId": agent["id"], "trace": make_trace(messages=discount_messages())}).json()
    assert r["context"] == "" and r["delivery"] == "unconfirmed" and "classifier error" in r["reason"]
    assert db.list_deliveries(c["id"]) == []


def test_mock_classifier_and_judge():
    m = MockLLM()
    t = make_trace(messages=discount_messages())
    assert m.classify(t, "x", ["cancel"])[0] and not m.classify(t, "x", ["refund"])[0]
    assert m.judge(make_trace(messages=[{"role": "user", "content": "this is useless"}]))["success"] is False
