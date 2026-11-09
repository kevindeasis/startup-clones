"""Anthropic client wrapper with a mock-mode switch."""
import os
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

try:  # optional
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # pragma: no cover
    pass

T = TypeVar("T", bound=BaseModel)


def is_mock() -> bool:
    if os.environ.get("CASEWORK_MOCK", "0").strip() in ("1", "true", "True", "yes"):
        return True
    return not os.environ.get("ANTHROPIC_API_KEY", "").strip()


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL", "").strip() or "claude-sonnet-4-5"


def _client():
    import anthropic
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def complete_json(system: str, user: str, schema_model: Type[T], max_tokens: int = 4096) -> T:
    """Force a single tool call whose input_schema is the pydantic schema; parse into the model.
    Retries once on validation error with the error text appended."""
    client = _client()
    tool = {
        "name": "emit_result",
        "description": f"Return the structured {schema_model.__name__}.",
        "input_schema": schema_model.model_json_schema(),
    }
    messages = [{"role": "user", "content": user}]
    last_err: Exception | None = None
    for attempt in range(2):
        resp = client.messages.create(
            model=model_name(), max_tokens=max_tokens, temperature=0,
            system=system, messages=messages, tools=[tool],
            tool_choice={"type": "tool", "name": "emit_result"},
        )
        block = next((b for b in resp.content if getattr(b, "type", "") == "tool_use"), None)
        if block is None:
            last_err = ValueError("no tool_use block returned")
        else:
            try:
                return schema_model.model_validate(block.input)
            except ValidationError as e:
                last_err = e
                messages = [{"role": "user", "content": user +
                             f"\n\nYour previous output failed validation:\n{e}\nFix it and call the tool again."}]
    raise RuntimeError(f"LLM output failed validation: {last_err}")
