"""Steer Python SDK: two calls per user turn, fail-open.

    steer = Steer(api_url=..., api_key=..., agent_id=...)
    ctx = steer.get_context(trace, timeout_ms=750)       # before the model call
    system = base + ("\\n\\n" + ctx.context if ctx.context else "")
    ... model call (unchanged) ...
    steer.capture_trace(trace, final=True, terminal="completed", outcome={"success": True})
"""
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

__all__ = ["Steer", "Context", "Turn"]


@dataclass
class Context:
    context: str = ""
    mode: str = "off"
    delivery: str = "unconfirmed"
    reason: str = ""
    elapsed_ms: int = 0
    corrections: list = field(default_factory=list)

    def __bool__(self):
        return bool(self.context)


class Turn:
    """Small helper that builds a trace for one user turn."""

    def __init__(self, steer: "Steer", conversation_id: str, revision: int, messages: list,
                 user: Optional[dict] = None, entry_point: str = "chat", trace_id: Optional[str] = None):
        self.steer, self.conversation_id, self.revision = steer, conversation_id, revision
        self.messages, self.user, self.entry_point = messages, user or {}, entry_point
        self.id = trace_id or str(uuid.uuid4())
        self._t0 = time.monotonic()

    def trace(self) -> dict:
        return {"id": self.id, "conversationId": self.conversation_id, "conversationRevision": self.revision,
                "entryPoint": self.entry_point, "user": self.user, "messages": self.messages,
                "turnLatencyMs": int((time.monotonic() - self._t0) * 1000)}

    def get_context(self, timeout_ms: Optional[int] = None) -> Context:
        return self.steer.get_context(self.trace(), timeout_ms=timeout_ms)

    def capture(self, final: bool = True, terminal: Optional[str] = "completed", outcome: Optional[dict] = None):
        return self.steer.capture_trace(self.trace(), final=final, terminal=terminal, outcome=outcome)


class Steer:
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None, agent_id: Optional[str] = None,
                 timeout_ms: int = 750, capture_timeout_ms: int = 3000, http_client: Any = None):
        self.api_url = (api_url or os.environ.get("STEER_API_URL") or "http://localhost:8790").rstrip("/")
        self.api_key = api_key or os.environ.get("STEER_API_KEY", "dev")
        self.agent_id = agent_id
        self.timeout_ms = timeout_ms
        self.capture_timeout_ms = capture_timeout_ms
        self._http = http_client or httpx
        self.last_error: Optional[str] = None

    def _post(self, path: str, body: dict, timeout_ms: int):
        t = max(timeout_ms, 1) / 1000
        return self._http.post(self.api_url + path, json=body, headers={"X-Steer-Key": self.api_key},
                               timeout=httpx.Timeout(t))

    def get_context(self, trace: dict, timeout_ms: Optional[int] = None) -> Context:
        """Never raises. On any failure returns an empty Context so the agent runs unchanged."""
        budget = timeout_ms or self.timeout_ms
        t0 = time.monotonic()
        try:
            resp = self._post("/v1/context", {"agentId": self.agent_id, "trace": trace,
                                              "timeout_ms": max(int(budget * 0.8), 1)}, budget)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            d = resp.json()
            return Context(context=d.get("context") or "", mode=d.get("mode", "off"),
                           delivery=d.get("delivery", "unconfirmed"), reason=d.get("reason", ""),
                           elapsed_ms=int((time.monotonic() - t0) * 1000), corrections=d.get("corrections", []))
        except Exception as e:  # fail open
            self.last_error = f"{type(e).__name__}: {e}"
            return Context(delivery="unconfirmed", reason=f"fail-open: {self.last_error}",
                           elapsed_ms=int((time.monotonic() - t0) * 1000))

    def capture_trace(self, trace: dict, final: bool = False, terminal: Optional[str] = None,
                      outcome: Optional[dict] = None) -> bool:
        """Never raises. Returns True when the server accepted the trace."""
        body: dict = {"agentId": self.agent_id, "trace": trace, "final": final}
        if terminal:
            body["terminal"] = terminal
        if outcome is not None:
            body["outcome"] = outcome
        try:
            resp = self._post("/v1/traces", body, self.capture_timeout_ms)
            ok = resp.status_code == 200
            if not ok:
                self.last_error = f"HTTP {resp.status_code}"
            return ok
        except Exception as e:
            self.last_error = f"{type(e).__name__}: {e}"
            return False

    def start_turn(self, conversation_id: str, revision: int, messages: list, user: Optional[dict] = None,
                   entry_point: str = "chat") -> Turn:
        return Turn(self, conversation_id, revision, messages, user, entry_point)
