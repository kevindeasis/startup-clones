"""Tiny Python SDK for the Agnost clone.

    client = AgnostClone("http://localhost:8000")
    client.track("conv-1", "user", "hi", user_id="u1", metadata={"plan": "pro"})
    client.track("conv-1", "assistant", "hello!")
    client.flush()
"""
from __future__ import annotations

import httpx

BATCH_SIZE = 50


class AgnostClone:
    def __init__(self, base_url: str = "http://localhost:8000", client: httpx.Client | None = None, batch_size: int = BATCH_SIZE):
        self.base_url = base_url.rstrip("/")
        # `client` lets callers inject any httpx.Client (e.g. FastAPI's TestClient for in-process use)
        self._http = client or httpx.Client(base_url=self.base_url, timeout=60)
        self.batch_size = batch_size
        self._buffer: list[dict] = []
        self.sent = 0

    def track(self, conversation_id: str, role: str, content: str, user_id: str | None = None,
              metadata: dict | None = None, timestamp: str | None = None) -> None:
        msg = {"conversation_id": conversation_id, "role": role, "content": content}
        if user_id is not None:
            msg["user_id"] = user_id
        if metadata:
            msg["metadata"] = metadata
        if timestamp:
            msg["timestamp"] = timestamp
        self._buffer.append(msg)

    def flush(self) -> dict:
        """POST buffered messages in batches of `batch_size`. Returns totals."""
        total = {"ingested": 0, "batches": 0}
        while self._buffer:
            batch, self._buffer = self._buffer[: self.batch_size], self._buffer[self.batch_size :]
            r = self._http.post("/api/v1/conversations", json={"messages": batch})
            r.raise_for_status()
            total["ingested"] += r.json()["ingested"]
            total["batches"] += 1
        self.sent += total["ingested"]
        return total

    # convenience wrappers around the other endpoints
    def analyze(self, force: bool = False) -> dict:
        r = self._http.post("/api/v1/analyze", params={"force": str(force).lower()})
        r.raise_for_status()
        return r.json()

    def cluster(self) -> dict:
        r = self._http.post("/api/v1/cluster")
        r.raise_for_status()
        return r.json()
