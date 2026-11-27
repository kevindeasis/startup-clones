import json
from types import SimpleNamespace

import pytest

from rehearsal.agent.support_agent import RunReport, run_agent, use_mock
from rehearsal.agent.tools import ToolExecutor


def test_use_mock_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("REHEARSAL_MOCK", raising=False)
    assert use_mock() is True
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert use_mock() is False
    monkeypatch.setenv("REHEARSAL_MOCK", "1")
    assert use_mock() is True


def test_mock_agent_happy_path(live):
    eid = live.env(scenario="refund_happy_path")
    rep = run_agent(live.base, eid, mock=True)
    assert isinstance(rep, RunReport) and rep.mode == "mock" and rep.stop_reason == "end_turn"
    assert [c["name"] for c in rep.tool_calls] == ["slack_read_channel", "stripe_find_customer", "stripe_list_charges",
                                                   "stripe_create_refund", "slack_post_message"]
    assert all(c["ok"] for c in rep.tool_calls) and "re_" in rep.final_text
    regs = live.http.get(f"/_sim/envs/{eid}/inspect").json()["registers"]
    assert len(regs["stripe.refunds"]) == 1
    reply = [m for m in regs["slack.messages"].values() if m.get("thread_ts")]
    assert len(reply) == 1 and "$49.00" in reply[0]["text"]


def test_mock_agent_naive_retry_double_refunds_on_dropped_write(live):
    eid = live.env(scenario="refund_flaky_network")
    rep = run_agent(live.base, eid, mock=True)
    creates = [c for c in rep.tool_calls if c["name"] == "stripe_create_refund"]
    assert [c["ok"] for c in creates] == [False, True] and "500" in creates[0]["error"]
    regs = live.http.get(f"/_sim/envs/{eid}/inspect").json()["registers"]
    assert len(regs["stripe.refunds"]) == 2 and {r["amount"] for r in regs["stripe.refunds"].values()} == {4900}
    assert regs["stripe.charges"]["ch_seedAcme001"]["amount_refunded"] == 9800


def test_idempotency_flag_prevents_double_refund(live):
    eid = live.env(scenario="refund_flaky_network")
    rep = run_agent(live.base, eid, mock=True, idempotency=True)
    assert [c["ok"] for c in rep.tool_calls if c["name"] == "stripe_create_refund"] == [False, True]
    regs = live.http.get(f"/_sim/envs/{eid}/inspect").json()["registers"]
    assert len(regs["stripe.refunds"]) == 1
    assert regs["stripe.charges"]["ch_seedAcme001"]["amount_refunded"] == 4900


def test_tool_executor_idempotency_key_is_sha256_prefix(live):
    eid = live.env(scenario="refund_happy_path")
    ex = ToolExecutor(live.base, eid, idempotency=True)
    ok, _ = ex.execute("stripe_create_refund", {"charge_id": "ch_seedAcme001"})
    assert ok
    import hashlib
    key = hashlib.sha256(b"ch_seedAcme001").hexdigest()[:32]
    regs = live.http.get(f"/_sim/envs/{eid}/inspect", params={"register": "stripe.idempotency_keys"}).json()["registers"]
    assert key in regs["stripe.idempotency_keys"]
    assert ex.execute("nope", {})[0] is False
    assert ex.execute("stripe_find_customer", {"email": "ghost@x.co"})[0] is False


def test_transport_error_is_reported_not_raised():
    ex = ToolExecutor("http://127.0.0.1:1", "env_x", timeout=1)
    ok, text = ex.execute("stripe_find_customer", {"email": "a@b.co"})
    assert ok is False and text.startswith("network error")


def test_github_triage_mock(live):
    eid = live.env(scenario="github_triage")
    rep = run_agent(live.base, eid, task="triage", mock=True)
    assert rep.stop_reason == "end_turn" and "#1" in rep.final_text and "#3" in rep.final_text


# ---- real-LLM path with a fake anthropic client ----
def _resp(stop, *blocks):
    return SimpleNamespace(stop_reason=stop, content=list(blocks))


def text(t):
    return SimpleNamespace(type="text", text=t)


def tool(i, name, inp):
    return SimpleNamespace(type="tool_use", id=i, name=name, input=inp)


class FakeClient:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []
        self.messages = self

    def create(self, **kw):
        self.calls.append(json.loads(json.dumps(kw, default=str)))
        return self.responses.pop(0)


def test_real_path_request_shape_and_tool_loop(live, monkeypatch):
    monkeypatch.delenv("REHEARSAL_MODEL", raising=False)
    eid = live.env(scenario="refund_happy_path")
    fake = FakeClient([
        _resp("tool_use", text("Looking."), tool("t1", "stripe_find_customer", {"email": "dana@example.com"})),
        _resp("tool_use", tool("t2", "stripe_find_customer", {"email": "ghost@example.com"})),
        _resp("end_turn", text("All done.")),
    ])
    rep = run_agent(live.base, eid, client=fake)
    assert rep.mode == "llm" and rep.steps == 3 and rep.final_text == "All done." and rep.stop_reason == "end_turn"
    kw = fake.calls[0]
    assert kw["model"] == "claude-sonnet-5-5" and kw["max_tokens"] == 4096
    assert "thinking" not in kw and "temperature" not in kw
    assert kw["system"].startswith("You are a support operations agent for Acme")
    assert {t["name"] for t in kw["tools"]} >= {"stripe_create_refund", "stripe_list_refunds"}
    # second call carries assistant tool_use + user tool_result (ok -> no is_error)
    msgs = fake.calls[1]["messages"]
    assert msgs[1]["role"] == "assistant" and msgs[1]["content"][1]["type"] == "tool_use"
    assert msgs[2]["content"][0]["type"] == "tool_result" and "is_error" not in msgs[2]["content"][0]
    # third call: failed lookup flagged is_error
    assert fake.calls[2]["messages"][4]["content"][0]["is_error"] is True
    assert [c["ok"] for c in rep.tool_calls] == [True, False]


def test_real_path_model_env_override(live, monkeypatch):
    monkeypatch.setenv("REHEARSAL_MODEL", "claude-test-model")
    fake = FakeClient([_resp("end_turn", text("hi"))])
    run_agent(live.base, live.env(), client=fake)
    assert fake.calls[0]["model"] == "claude-test-model"


@pytest.mark.parametrize("stop,expect", [
    ("max_tokens", "max_tokens"), ("refusal", "refused"), ("weird_stop", "unexpected stop_reason weird_stop")])
def test_real_path_terminal_stop_reasons(live, stop, expect):
    fake = FakeClient([_resp(stop)])
    rep = run_agent(live.base, live.env(), client=fake)
    assert rep.stop_reason == stop and expect in rep.final_text and rep.steps == 1


def test_real_path_max_steps(live):
    eid = live.env(scenario="refund_happy_path")
    loop = [_resp("tool_use", tool(f"t{i}", "stripe_find_customer", {"email": "dana@example.com"})) for i in range(5)]
    rep = run_agent(live.base, eid, client=FakeClient(loop), max_steps=3)
    assert rep.steps == 3 and rep.stop_reason == "max_steps" and "max steps" in rep.final_text


def test_mock_refund_amount_parsing_and_full_refund_fallback():
    from rehearsal.agent.mock_llm import REFUND_AMOUNT
    assert REFUND_AMOUNT.search("charged $98 instead of $49. Please refund the duplicate $49.").group(1) == "49"
    assert REFUND_AMOUNT.search("please refund $1,200.50 today").group(1) == "1,200.50"
    assert REFUND_AMOUNT.search("I want my money back, $49") is None
