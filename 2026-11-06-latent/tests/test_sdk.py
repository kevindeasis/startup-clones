import socket
import threading
import time

import pytest
import uvicorn

import latentclone
from tests.conftest import BAD, GOOD, SOURCES


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def server(env):
    from app.main import app

    port = free_port()
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    srv.should_exit = True
    t.join(timeout=5)


def reset():
    with latentclone._lock:
        for k in latentclone._stats:
            latentclone._stats[k] = 0


def test_capture_reaches_server(server, env):
    reset()
    env.setenv("LATENT_API_URL", server)
    latentclone.capture("What was Q3 revenue?", GOOD, SOURCES)
    latentclone.capture("What was Q3 revenue?", BAD, SOURCES)
    assert latentclone.flush(10)
    s = latentclone.stats()
    assert s["captured"] == 2 and s["sent"] >= 2 and s["flagged"] == 1 and s["errors"] == 0


def test_fail_open_closed_port(env):
    reset()
    env.setenv("LATENT_API_URL", f"http://127.0.0.1:{free_port()}")
    latentclone.capture("p", "a")  # must not raise
    assert latentclone.flush(10)
    assert latentclone.stats()["errors"] >= 1


def test_auto_instrument_fail_open(env):
    anthropic = pytest.importorskip("anthropic")
    from anthropic.resources.messages import Messages

    reset()
    env.setenv("LATENT_API_URL", f"http://127.0.0.1:{free_port()}")
    orig = Messages.create

    def fake(self, *a, **kw):
        return type("R", (), {"content": [type("B", (), {"type": "text", "text": "hello"})()]})()

    env.setattr(Messages, "create", fake)
    try:
        assert latentclone.auto_instrument()
        resp = Messages.create(None, model="m", max_tokens=5,
                               messages=[{"role": "user", "content": "hi"}])
        assert resp.content[0].text == "hello"
        assert latentclone.stats()["captured"] == 1
        latentclone.flush(10)
    finally:
        latentclone._original_create = None
        assert anthropic is not None and orig is not None
