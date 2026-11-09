"""latentclone: zero-dependency, off-thread, fail-open SDK for the Latent clone server."""
from __future__ import annotations

import json
import os
import queue
import threading
import time
import urllib.request
from typing import Any

__all__ = ["capture", "auto_instrument", "flush", "stats"]

_q: "queue.Queue[dict[str, Any]]" = queue.Queue()
_lock = threading.Lock()
_stats = {"captured": 0, "sent": 0, "errors": 0, "flagged": 0}
_worker: threading.Thread | None = None
_original_create: Any = None


def _bump(key: str, n: int = 1) -> None:
    with _lock:
        _stats[key] += n


def _send(item: dict[str, Any]) -> None:
    url = os.environ.get("LATENT_API_URL", "http://127.0.0.1:8000").rstrip("/") + "/v1/score"
    headers = {"content-type": "application/json"}
    key = os.environ.get("LATENT_API_KEY", "")
    if key:
        headers["authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=json.dumps(item).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read().decode())
    _bump("sent")
    if body.get("flagged"):
        _bump("flagged")


def _run() -> None:
    while True:
        item = _q.get()
        try:
            _send(item)
        except Exception:
            _bump("errors")
        finally:
            _q.task_done()


def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_run, name="latentclone", daemon=True)
        _worker.start()


def capture(prompt: str, answer: str, sources: list[str] | None = None, policy: str = "deliver") -> None:
    """Enqueue a record for scoring. Never raises."""
    try:
        _ensure_worker()
        _q.put({"prompt": prompt, "answer": answer, "sources": list(sources or []), "policy": policy})
        _bump("captured")
    except Exception:
        _bump("errors")


def flush(timeout: float = 5.0) -> bool:
    """Wait until the queue is drained. Returns True if drained within timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _q.unfinished_tasks == 0:
            return True
        time.sleep(0.02)
    return _q.unfinished_tasks == 0


def stats() -> dict[str, int]:
    with _lock:
        return dict(_stats)


def _message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict):
            if block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        elif getattr(block, "type", "") == "text":
            parts.append(str(getattr(block, "text", "")))
    return "".join(parts)


def _capture_call(kwargs: dict[str, Any], response: Any) -> None:
    prompt = ""
    for m in reversed(kwargs.get("messages") or []):
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
        if role == "user":
            content = m.get("content") if isinstance(m, dict) else getattr(m, "content", "")
            prompt = _message_text(content)
            break
    answer = _message_text(getattr(response, "content", []))
    if answer:
        capture(prompt, answer)


def auto_instrument() -> bool:
    """Patch anthropic Messages.create to capture prompt/answer. Fail-open. Idempotent."""
    global _original_create
    try:
        from anthropic.resources.messages import Messages
    except Exception:
        return False
    try:
        if _original_create is not None:
            return True
        original = Messages.create
        _original_create = original

        def create(self: Any, *args: Any, **kwargs: Any) -> Any:
            response = original(self, *args, **kwargs)  # host errors propagate untouched
            try:
                _capture_call(kwargs, response)
            except Exception:
                _bump("errors")
            return response

        Messages.create = create  # type: ignore[method-assign]
        return True
    except Exception:
        _bump("errors")
        return False


def _uninstrument() -> None:
    """Restore the original method (used by tests)."""
    global _original_create
    if _original_create is not None:
        from anthropic.resources.messages import Messages

        Messages.create = _original_create  # type: ignore[method-assign]
        _original_create = None
