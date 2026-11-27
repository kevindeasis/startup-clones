"""The sample agents (support refund agent + GitHub triage agent) and their tool-use loop."""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from typing import Any

from .mock_llm import MockClient
from .tools import TOOLS_BY_TASK, ToolExecutor

SYSTEM_PROMPTS = {
    "support": (
        "You are a support operations agent for Acme. Read the latest complaints in Slack #support, find the "
        "matching Stripe customer by email, locate their most recent succeeded charge, refund the disputed amount the customer asks for (the full charge only if they ask for a full refund), then reply "
        "in the same Slack thread confirming the refund amount and refund id. Use tools; never claim an action you "
        "did not perform. If a tool call fails with a network error, check state before retrying any write."
    ),
    "triage": (
        "You are an issue triage agent for Acme. List the open issues in the given GitHub repo. For each issue that "
        "describes a bug (crash, error, regression, broken behaviour) add the label `bug` and leave a short comment. "
        "Use tools; never claim an action you did not perform. If a tool call fails with a network error, check state "
        "before retrying any write."
    ),
}
USER_PROMPTS = {
    "support": "Process the latest complaints in #support now.",
    "triage": "Triage the open issues in acme/widgets.",
}


@dataclass
class RunReport:
    steps: int = 0
    tool_calls: list[dict] = field(default_factory=list)
    final_text: str = ""
    mode: str = "mock"
    stop_reason: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def use_mock(mock: bool | None = None) -> bool:
    if mock:
        return True
    if os.environ.get("REHEARSAL_MOCK", "").strip() not in ("", "0"):
        return True
    return not os.environ.get("ANTHROPIC_API_KEY")


def _block_to_dict(b: Any) -> dict:
    t = getattr(b, "type", None)
    if t == "text":
        return {"type": "text", "text": b.text}
    if t == "tool_use":
        return {"type": "tool_use", "id": b.id, "name": b.name, "input": dict(b.input)}
    return {"type": t or "text", "text": getattr(b, "text", "")}


def run_agent(base: str, env_id: str, *, task: str = "support", idempotency: bool = False,
              mock: bool | None = None, max_steps: int = 12, client: Any = None) -> RunReport:
    """Standard tool-use loop. `client` may be injected (tests pass a fake with .messages.create)."""
    is_mock = client is None and use_mock(mock)
    if client is None:
        if is_mock:
            client = MockClient()
        else:
            import anthropic
            client = anthropic.Anthropic()
    report = RunReport(mode="mock" if is_mock else "llm")
    executor = ToolExecutor(base, env_id, idempotency=idempotency)
    model = os.environ.get("REHEARSAL_MODEL", "claude-sonnet-5-5")
    messages: list[dict] = [{"role": "user", "content": USER_PROMPTS[task]}]
    report.stop_reason = "max_steps"
    for _ in range(max_steps):
        resp = client.messages.create(model=model, max_tokens=4096, system=SYSTEM_PROMPTS[task],
                                      tools=TOOLS_BY_TASK[task], messages=messages)
        report.steps += 1
        blocks = [_block_to_dict(b) for b in resp.content]
        messages.append({"role": "assistant", "content": blocks})
        text = "".join(b["text"] for b in blocks if b["type"] == "text")
        sr = resp.stop_reason
        if sr == "tool_use":
            results = []
            for b in blocks:
                if b["type"] != "tool_use":
                    continue
                ok, out = executor.execute(b["name"], b["input"])
                entry: dict[str, Any] = {"name": b["name"], "input": b["input"], "ok": ok}
                if not ok:
                    entry["error"] = out
                report.tool_calls.append(entry)
                res: dict[str, Any] = {"type": "tool_result", "tool_use_id": b["id"], "content": out}
                if not ok:
                    res["is_error"] = True
                results.append(res)
            messages.append({"role": "user", "content": results})
            continue
        report.stop_reason = sr
        if sr == "end_turn":
            report.final_text = text
        elif sr == "max_tokens":
            report.final_text = (text + " " if text else "") + "[stopped: response hit max_tokens]"
        elif sr == "refusal":
            report.final_text = text or "[model refused the request]"
        else:
            report.final_text = text or f"[stopped: unexpected stop_reason {sr}]"
        break
    else:
        report.final_text = report.final_text or "[stopped: max steps reached]"
    executor.http.close()
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Rehearsal sample agent")
    ap.add_argument("--base", default=f"http://localhost:{os.environ.get('REHEARSAL_PORT', '8787')}")
    ap.add_argument("--env", required=True)
    ap.add_argument("--task", choices=sorted(TOOLS_BY_TASK), default="support")
    ap.add_argument("--idempotency", action="store_true")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--max-steps", type=int, default=12)
    a = ap.parse_args(argv)
    rep = run_agent(a.base, a.env, task=a.task, idempotency=a.idempotency, mock=a.mock or None, max_steps=a.max_steps)
    print(json.dumps(rep.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
