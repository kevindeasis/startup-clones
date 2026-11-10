import json
import os
import re

from . import config


def is_mock() -> bool:
    return os.environ.get("MOCK_LLM", "") == "1" or not os.environ.get("ANTHROPIC_API_KEY")


def extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=-1)
    if start >= 0:
        closer = "}" if text[start] == "{" else "]"
        end = text.rfind(closer)
        if end > start:
            return json.loads(text[start:end + 1])
    raise ValueError("no JSON found in model output")


def complete_json(system: str, user: str, schema_hint: str):
    """Call Claude demanding JSON-only output; retry once on parse failure. Not used in mock mode."""
    if is_mock():
        raise RuntimeError("complete_json called in mock mode; callers must use their mock path")
    import anthropic
    client = anthropic.Anthropic()
    sys_prompt = (f"{system}\n\nRespond with ONLY a single valid JSON value, no prose, no markdown fences. "
                  f"It must match this shape:\n{schema_hint}")
    msgs = [{"role": "user", "content": user}]
    last_err = None
    for _ in range(2):
        resp = client.messages.create(model=config.model_name(), max_tokens=1500, system=sys_prompt, messages=msgs)
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        try:
            return extract_json(text)
        except Exception as e:  # retry once with a reminder
            last_err = e
            msgs = [{"role": "user", "content": user + "\n\nYour previous reply was not valid JSON. Reply with JSON only."}]
    raise ValueError(f"LLM did not return valid JSON: {last_err}")
