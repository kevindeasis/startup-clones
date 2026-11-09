"""LLM provider abstraction: Anthropic + deterministic mock.

All methods take an optional `task` hint (requirements | contradictions | ask | notice)
which only the mock provider uses; user prompts for structured tasks are JSON strings.
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

DEFAULT_MODEL = "claude-sonnet-5-5"


class LLMError(Exception):
    """Upstream/parse failure (maps to HTTP 502)."""


class LLMConfigError(LLMError):
    """Misconfiguration, e.g. provider=anthropic without key (maps to HTTP 400)."""


def parse_json_loose(text: str) -> Any:
    """Parse JSON from model output: strips code fences, tolerates surrounding prose."""
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.S | re.I)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    starts = [i for i in (t.find("{"), t.find("[")) if i != -1]
    if starts:
        s = min(starts)
        e = max(t.rfind("}"), t.rfind("]"))
        if e > s:
            return json.loads(t[s : e + 1])
    raise ValueError("no JSON found in model output")


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, client: Any = None):
        self.model = model
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
        self.client = client

    def complete_text(self, system: str, user: str, task: Optional[str] = None) -> str:
        return self._call(system, [{"role": "user", "content": user}])

    def _call(self, system: str, messages: List[dict]) -> str:
        try:
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                temperature=0,
                system=system,
                messages=messages,
            )
        except Exception as e:
            raise LLMError(f"Anthropic API call failed: {e}") from e
        return "".join(
            getattr(b, "text", "") for b in resp.content if getattr(b, "type", "text") == "text"
        )

    def complete_json(
        self, system: str, user: str, schema_hint: str = "", task: Optional[str] = None
    ) -> Dict[str, Any]:
        sys2 = f"{system}\n\nRespond with ONLY a single valid JSON value, no prose, no code fences."
        if schema_hint:
            sys2 += f"\nExpected shape: {schema_hint}"
        msgs = [{"role": "user", "content": user}]
        raw = self._call(sys2, msgs)
        try:
            return parse_json_loose(raw)
        except Exception:
            msgs += [
                {"role": "assistant", "content": raw or "(empty)"},
                {"role": "user", "content": "That was not valid JSON. Reply with valid JSON only."},
            ]
            raw2 = self._call(sys2, msgs)
            try:
                return parse_json_loose(raw2)
            except Exception as e:
                raise LLMError(f"Model did not return valid JSON after retry: {e}") from e


def provider_config() -> Dict[str, str]:
    """Resolve provider name/model from env without constructing any client."""
    choice = os.getenv("LLM_PROVIDER", "auto").strip().lower() or "auto"
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    model = os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if choice == "auto":
        choice = "anthropic" if key else "mock"
    if choice not in ("anthropic", "mock"):
        choice = "mock"
    return {"provider": choice, "model": model if choice == "anthropic" else "mock", "key": key}


_PROVIDER = None


def reset_provider() -> None:
    global _PROVIDER
    _PROVIDER = None


def get_provider():
    global _PROVIDER
    cfg = provider_config()
    if _PROVIDER is not None and _PROVIDER.name == cfg["provider"] and _PROVIDER.model == cfg["model"]:
        return _PROVIDER
    if cfg["provider"] == "anthropic":
        if not cfg["key"]:
            raise LLMConfigError(
                "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. "
                "Set the key or use LLM_PROVIDER=mock/auto."
            )
        _PROVIDER = AnthropicProvider(cfg["key"], cfg["model"])
    else:
        from .mock_llm import MockProvider

        _PROVIDER = MockProvider()
    return _PROVIDER
