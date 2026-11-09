"""LLM provider abstraction: Anthropic (default when key set) and a deterministic mock."""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from . import mock_llm

log = logging.getLogger("claimsleuth.llm")

SYSTEM_PROMPT = (
    "You are a P&C claims investigation assistant. You only state what the documents support, "
    "you quote verbatim, you never invent facts, you return JSON only matching the given schema."
)


@dataclass
class Usage:
    model: str
    input_tokens: int
    output_tokens: int


def provider_name() -> str:
    p = os.environ.get("LLM_PROVIDER", "").strip().lower()
    if p in ("anthropic", "mock"):
        if p == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
            log.warning("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty; falling back to mock")
            return "mock"
        return p
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    log.warning("No ANTHROPIC_API_KEY set; using the mock LLM provider")
    return "mock"


def strip_fences(text: str) -> str:
    t = text.strip()
    m = re.match(r"^```(?:json)?\s*(.*?)\s*```$", t, re.S)
    if m:
        return m.group(1)
    # tolerate prose around a single JSON object
    if not t.startswith("{") and "{" in t and "}" in t:
        return t[t.index("{"): t.rindex("}") + 1]
    return t


def _raw_anthropic(system: str, blocks: list[dict]) -> tuple[str, Usage]:
    import anthropic

    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    resp = client.messages.create(
        model=model,
        max_tokens=8192,
        system=system,
        messages=[{"role": "user", "content": blocks}],
    )
    text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
    return text, Usage(model, resp.usage.input_tokens, resp.usage.output_tokens)


def _raw_mock(system: str, blocks: list[dict], schema_model: type[BaseModel]) -> tuple[str, Usage]:
    text = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    out = mock_llm.generate(schema_model, text)
    raw = json.dumps(out)
    return raw, Usage("mock-heuristic-v1", len(text) // 4, len(raw) // 4)


def complete_json_with_usage(system: str, user_blocks: list[dict], schema_model: type[BaseModel]) -> tuple[BaseModel, Usage]:
    """Call the provider, parse JSON into schema_model; on ValidationError re-ask once.

    Returns (instance, usage) with token counts summed over attempts."""
    prov = provider_name()

    def call(blocks):
        return _raw_anthropic(system, blocks) if prov == "anthropic" else _raw_mock(system, blocks, schema_model)

    raw, usage = call(user_blocks)
    try:
        return schema_model.model_validate_json(strip_fences(raw)), usage
    except (ValidationError, ValueError) as e:
        log.warning("validation failed, retrying once: %s", e)
        retry = list(user_blocks) + [{
            "type": "text",
            "text": f"\n\nYour previous reply was invalid:\n{raw[:2000]}\n\nError:\n{str(e)[:1500]}\n\nReturn corrected JSON only.",
        }]
        raw2, usage2 = call(retry)
        usage = Usage(usage2.model, usage.input_tokens + usage2.input_tokens, usage.output_tokens + usage2.output_tokens)
        return schema_model.model_validate_json(strip_fences(raw2)), usage


def complete_json(system: str, user_blocks: list[dict], schema_model: type[BaseModel]) -> BaseModel:
    return complete_json_with_usage(system, user_blocks, schema_model)[0]
