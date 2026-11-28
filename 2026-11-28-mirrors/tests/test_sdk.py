import time

import httpx

from steer_sdk import Steer
from tests.conftest import discount_messages, make_trace
from tests.test_api import make_active


def test_unreachable_fails_open_within_budget():
    s = Steer("http://127.0.0.1:1", "dev", "agent", timeout_ms=300)
    t0 = time.monotonic()
    ctx = s.get_context(make_trace(), timeout_ms=300)
    assert (time.monotonic() - t0) < 0.3 + 0.25
    assert ctx.context == "" and ctx.delivery == "unconfirmed" and not ctx


def test_server_500_fails_open():
    def handler(request):
        return httpx.Response(500, text="boom")
    s = Steer("http://x", "dev", "a", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert s.get_context(make_trace()).context == ""
    assert s.capture_trace(make_trace(), final=True) is False


def test_garbage_json_fails_open():
    s = Steer("http://x", "dev", "a", http_client=httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text="not json"))))
    assert s.get_context(make_trace()).context == ""


def test_roundtrip_delivers_guidance(client, agent):
    make_active(client, agent)
    s = Steer("http://testserver", "dev", agent["id"], http_client=client)
    ctx = s.get_context(make_trace(messages=discount_messages()))
    assert "do not offer again" in ctx.context and ctx.mode == "active" and ctx.corrections
    assert s.capture_trace(make_trace("cap1", messages=discount_messages()), final=True, terminal="completed",
                           outcome={"success": True})
    assert client.get("/v1/turns/cap1").json()["outcome_success"] is True


def test_start_turn_builds_trace(client, agent):
    s = Steer("http://testserver", "dev", agent["id"], http_client=client)
    turn = s.start_turn("conv", 2, [{"role": "user", "content": "hi"}], {"id": "u", "segment": "pro"})
    tr = turn.trace()
    assert tr["conversationId"] == "conv" and tr["conversationRevision"] == 2 and tr["id"]
    assert turn.capture(final=True)
