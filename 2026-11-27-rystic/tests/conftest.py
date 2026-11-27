import os
import socket
import threading
import time

import httpx
import pytest
import uvicorn

os.environ.setdefault("REHEARSAL_MOCK", "1")

from rehearsal.server import create_app  # noqa: E402

SK = {"Authorization": "Bearer sk_test_x"}
XOXB = {"Authorization": "Bearer xoxb-x"}
GHP = {"Authorization": "Bearer ghp_x"}


class Live:
    def __init__(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.app = create_app()
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.thread.start()
        for _ in range(100):
            if self.server.started:
                break
            time.sleep(0.05)
        self.base = f"http://127.0.0.1:{self.port}"
        self.http = httpx.Client(base_url=self.base, timeout=10)

    def env(self, **body):
        r = self.http.post("/_sim/envs", json=body)
        assert r.status_code == 201, r.text
        return r.json()["env_id"]

    def stop(self):
        self.server.should_exit = True
        self.thread.join(timeout=5)


@pytest.fixture(scope="session", autouse=True)
def _persist(tmp_path_factory):
    os.environ["REHEARSAL_PERSIST_DIR"] = str(tmp_path_factory.mktemp("persist"))


@pytest.fixture(scope="session")
def live():
    lv = Live()
    yield lv
    lv.stop()


@pytest.fixture
def env_id(live):
    return live.env()
