"""LLM layer: Anthropic wrapper, deterministic MockLLM, JSON extraction, semantic classifier."""
import json
import os
import re
from typing import Optional

DEFAULT_MODEL = "claude-sonnet-5-5"
MAX_TOKENS = 4096

FRUSTRATION_RX = re.compile(r"frustrat|already said|this is useless|stop offering", re.IGNORECASE)
_STOP = {"customer", "about", "their", "where", "which", "while", "there", "these", "those", "would", "could"}


class LLMError(Exception):
    pass


class LLMRefusal(LLMError):
    pass


def extract_json(text: str):
    """Defensively pull a JSON object out of model text (plain, fenced, or surrounded by prose)."""
    if text is None:
        raise ValueError("empty response")
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL | re.IGNORECASE)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    start = t.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            ch = t[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(t[start:i + 1])
                    except ValueError:
                        break
        start = t.find("{", start + 1)
    raise ValueError("no JSON object found in model output")


def compress_trace(messages: list, limit: int = 1200, last_n: int = 6) -> str:
    parts = []
    for m in messages[-last_n:]:
        role = m.get("role")
        if role == "system":
            continue
        c = (m.get("content") or "").replace("\n", " ")
        if role == "tool":
            parts.append(f"[tool result {m.get('name','')}] {c[:120]}")
        else:
            s = f"{role}: {c[:240]}"
            tcs = m.get("toolCalls") or []
            if tcs:
                s += " [calls: " + ", ".join(t["name"] for t in tcs) + "]"
            parts.append(s)
    return "\n".join(parts)[:limit]


def _keywords_from(situation: str, keywords: list) -> list:
    if keywords:
        return [k.lower() for k in keywords]
    return [w for w in re.findall(r"[a-z]{5,}", situation.lower()) if w not in _STOP]


class MockLLM:
    """Deterministic stand-in: no network. Discovery uses heuristics (see discovery.py)."""
    mock = True

    def classify(self, trace: dict, situation: str, keywords: list, timeout: Optional[float] = None):
        kws = _keywords_from(situation, keywords)
        text = " ".join((m.get("content") or "") for m in trace.get("messages", [])
                        if m.get("role") in ("user", "tool")).lower()
        hits = [k for k in kws if k in text]
        return (bool(hits), f"mock keyword match: {hits}" if hits else "mock: no keywords present")

    def judge(self, trace: dict, timeout: Optional[float] = None):
        users = [m for m in trace.get("messages", []) if m.get("role") == "user"]
        last = users[-1]["content"] if users else ""
        bad = bool(FRUSTRATION_RX.search(last))
        return {"success": not bad, "note": "mock judge: frustration detected" if bad else "mock judge: ok"}

    def discover(self, *a, **k):
        return None  # signals "use heuristics"


class AnthropicLLM:
    mock = False

    def __init__(self, client=None, model: Optional[str] = None):
        self.model = model or os.environ.get("STEER_MODEL") or DEFAULT_MODEL
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        self.client = client
        self.last_stop_reason = None

    def complete(self, system: str, user: str, timeout: Optional[float] = None) -> str:
        kwargs = dict(model=self.model, max_tokens=MAX_TOKENS, system=system,
                      messages=[{"role": "user", "content": user}])
        if timeout is not None:
            kwargs["timeout"] = timeout
        resp = self.client.messages.create(**kwargs)
        stop = getattr(resp, "stop_reason", None)
        self.last_stop_reason = stop
        if stop == "refusal":
            raise LLMRefusal("model refused the request")
        text = None
        for block in getattr(resp, "content", None) or []:
            if getattr(block, "type", None) == "text":
                text = getattr(block, "text", "")
                break
        if text is None:
            raise LLMError("no text block in response")
        if stop == "max_tokens":
            # Output was cut off; callers parse defensively and treat parse failure as LLMError.
            self.truncated = True
        else:
            self.truncated = False
        return text

    def _json(self, system, user, timeout=None):
        text = self.complete(system, user, timeout)
        try:
            return extract_json(text)
        except ValueError as e:
            suffix = " (response hit max_tokens)" if self.last_stop_reason == "max_tokens" else ""
            raise LLMError(f"unparseable JSON{suffix}: {e}")

    def classify(self, trace: dict, situation: str, keywords: list, timeout: Optional[float] = None):
        system = ("You decide whether an AI agent conversation is currently in a described situation. "
                  'Reply with JSON only: {"matches": true|false, "reason": "short reason"}.')
        user = f"Situation: {situation}\n\nConversation (most recent last):\n{compress_trace(trace.get('messages', []))}"
        data = self._json(system, user, timeout)
        return bool(data.get("matches")), str(data.get("reason", ""))

    def judge(self, trace: dict, timeout: Optional[float] = None):
        system = ("You judge whether a user's goal was achieved in an AI agent conversation. "
                  'Reply with JSON only: {"success": true|false, "note": "short reason"}.')
        data = self._json(system, compress_trace(trace.get("messages", []), limit=2000, last_n=10), timeout)
        return {"success": bool(data.get("success")), "note": str(data.get("note", ""))}

    def discover(self, system: str, user: str):
        return self._json(system, user)


def make_llm():
    if os.environ.get("STEER_MOCK") in ("1", "true", "yes") or not os.environ.get("ANTHROPIC_API_KEY"):
        return MockLLM()
    return AnthropicLLM()
