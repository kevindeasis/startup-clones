import pytest
from fastapi.testclient import TestClient

from steer.db import Database
from steer.llm import MockLLM
from steer.server import create_app

H = {"X-Steer-Key": "dev"}


@pytest.fixture
def client():
    app = create_app(db=Database(":memory:"), llm=MockLLM(), api_key="dev")
    with TestClient(app, headers=H) as c:
        yield c


@pytest.fixture
def agent(client):
    return client.post("/v1/agents", json={"name": "t"}).json()


def msg(role, content="", **kw):
    return {"role": role, "content": content, **kw}


def make_trace(tid="t1", conv="c1", rev=1, messages=None, segment="pro", entry="chat"):
    return {"id": tid, "conversationId": conv, "conversationRevision": rev, "entryPoint": entry,
            "user": {"id": "u1", "segment": segment},
            "messages": messages or [msg("user", "hello")]}


def discount_messages(declined=True):
    m = [msg("user", "I want to cancel"),
         msg("assistant", "How about 20% off?", toolCalls=[{"callId": "a", "name": "offer_discount",
                                                            "arguments": {"pct": 20}}]),
         msg("tool", '{"offered": true}', callId="a", name="offer_discount")]
    if declined:
        m.append(msg("user", "No thanks, just cancel"))
    return m


DISCOUNT_TRIGGER = {"all": [{"type": "tool_called", "name": "offer_discount", "min_count": 1},
                            {"type": "message_matches", "role": "user", "pattern": "no thanks", "where": "last"}]}
