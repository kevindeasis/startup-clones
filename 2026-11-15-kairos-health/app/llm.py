"""Live LLM path: Anthropic SDK, manual tool-use loop (default tool_choice, strict tools)."""
import json

from . import config

MAX_ITERATIONS = 8


def get_client():
    import anthropic

    return anthropic.Anthropic(api_key=config.api_key())


def block_to_dict(b) -> dict:
    t = getattr(b, "type", None)
    if t == "text":
        return {"type": "text", "text": b.text}
    if t == "tool_use":
        return {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
    return b.model_dump(exclude_none=True)


def run_tool_loop(client, system: str, tools: list, messages: list, execute) -> tuple[str, list]:
    """Run the tool-use loop until end_turn (or 8 iterations).

    `messages` is mutated in place (assistant blocks and ONE user message holding all tool results per turn).
    `execute(name, input) -> dict`. Returns (reply_text, tool_calls).
    """
    calls = []
    reply = ""
    for _ in range(MAX_ITERATIONS):
        resp = client.messages.create(model=config.model(), max_tokens=2048, system=system, tools=tools, messages=messages)
        content = [block_to_dict(b) for b in resp.content]
        messages.append({"role": "assistant", "content": content})
        text = " ".join(b["text"] for b in content if b.get("type") == "text").strip()
        if text:
            reply = text
        if resp.stop_reason != "tool_use":
            break
        results = []
        for b in content:
            if b.get("type") == "tool_use":
                res = execute(b["name"], b["input"])
                calls.append({"name": b["name"], "input": b["input"], "result": res})
                results.append({"type": "tool_result", "tool_use_id": b["id"], "content": json.dumps(res)})
        messages.append({"role": "user", "content": results})
    return reply, calls


def complete_text(prompt: str, system: str = "", max_tokens: int = 400) -> str:
    client = get_client()
    resp = client.messages.create(model=config.model(), max_tokens=max_tokens, system=system or "You write short, friendly SMS messages.",
                                  messages=[{"role": "user", "content": prompt}])
    return " ".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
