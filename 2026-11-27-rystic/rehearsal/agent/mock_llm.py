"""Deterministic scripted 'LLM' with the same surface as anthropic.Anthropic().messages.create.

It is deliberately NAIVE: when stripe_create_refund errors it retries once immediately, without
checking stripe_list_refunds first. That is what makes the flaky-network scenario fail.
"""
from __future__ import annotations

import json
import re
from types import SimpleNamespace

EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
REFUND_AMOUNT = re.compile(r"refund\b[^$]*\$\s?([\d,]+(?:\.\d{1,2})?)", re.I)
BUG_WORDS = ("bug", "crash", "error", "exception", "broken", "fails", "failing", "regression", "traceback", "500")


def _history(messages: list[dict]) -> list[dict]:
    """Flatten the transcript into [{name, input, content, is_error}] in call order."""
    calls: dict[str, dict] = {}
    order: list[str] = []
    for m in messages:
        if not isinstance(m.get("content"), list):
            continue
        for b in m["content"]:
            if b.get("type") == "tool_use":
                calls[b["id"]] = {"name": b["name"], "input": b["input"], "content": None, "is_error": False}
                order.append(b["id"])
            elif b.get("type") == "tool_result" and b["tool_use_id"] in calls:
                calls[b["tool_use_id"]]["content"] = b.get("content")
                calls[b["tool_use_id"]]["is_error"] = bool(b.get("is_error"))
    return [calls[i] for i in order]


def _tool(n: int, name: str, args: dict):
    block = SimpleNamespace(type="tool_use", id=f"toolu_mock_{n:03d}", name=name, input=args)
    return SimpleNamespace(stop_reason="tool_use", content=[block], model="mock", usage=SimpleNamespace(input_tokens=0, output_tokens=0))


def _end(text: str):
    return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)], model="mock",
                           usage=SimpleNamespace(input_tokens=0, output_tokens=0))


def _json(call: dict):
    try:
        return json.loads(call["content"])
    except (TypeError, ValueError):
        return None


def support_step(done: list[dict]):
    n = len(done) + 1
    by = lambda name: [d for d in done if d["name"] == name]  # noqa: E731
    if not done:
        return _tool(n, "slack_read_channel", {"channel_name": "support", "limit": 10})
    read = by("slack_read_channel")[0]
    if read["is_error"]:
        return _end(f"I could not read #support: {read['content']}")
    msgs = _json(read) or []
    complaint = next((m for m in msgs if EMAIL.search(m.get("text", ""))), None)
    if not complaint:
        return _end("No complaints with a customer email found in #support.")
    email = EMAIL.search(complaint["text"]).group(0)
    thread_ts = complaint.get("thread_ts") or complaint["ts"]
    find = by("stripe_find_customer")
    if not find:
        return _tool(n, "stripe_find_customer", {"email": email})
    if find[0]["is_error"]:
        return _end(f"I could not find a Stripe customer for {email}.")
    cust = _json(find[0])
    charges_call = by("stripe_list_charges")
    if not charges_call:
        return _tool(n, "stripe_list_charges", {"customer_id": cust["id"], "limit": 10})
    charges = _json(charges_call[0]) or []
    charge = next((c for c in charges if c["status"] == "succeeded"), None)
    if charge is None:
        return _end(f"No succeeded charge found for {email}.")
    refund_args = {"charge_id": charge["id"]}
    m = REFUND_AMOUNT.search(complaint["text"])
    if m:  # dollar amount after the word "refund"; otherwise omit amount (full refund)
        refund_args["amount"] = round(float(m.group(1).replace(",", "")) * 100)
    refunds = by("stripe_create_refund")
    if not refunds:
        return _tool(n, "stripe_create_refund", dict(refund_args))
    if refunds[-1]["is_error"]:
        if len(refunds) == 1:  # naive: retry once, immediately, without checking state
            return _tool(n, "stripe_create_refund", dict(refund_args))
        return _end(f"The refund for {charge['id']} failed after a retry: {refunds[-1]['content']}")
    refund = _json(refunds[-1])
    posts = by("slack_post_message")
    text = f"Refunded ${refund['amount'] / 100:.2f} for charge {charge['id']}. Refund id: {refund['id']}."
    if not posts:
        return _tool(n, "slack_post_message", {"channel": complaint.get("channel", "#support"), "text": text,
                                               "thread_ts": thread_ts})
    if posts[-1]["is_error"]:
        return _end(f"The refund {refund['id']} was issued but I could not post the confirmation.")
    return _end(text)


def triage_step(done: list[dict], user_text: str):
    n = len(done) + 1
    repo = (re.search(r"[\w-]+/[\w-]+", user_text) or [None])[0]
    if not done:
        return _tool(n, "github_list_issues", {"repo": repo, "state": "open"})
    listing = done[0]
    if listing["is_error"]:
        return _end(f"Could not list issues: {listing['content']}")
    issues = _json(listing) or []
    bugs = [i for i in issues if any(w in f"{i['title']} {i.get('body') or ''}".lower() for w in BUG_WORDS)]
    for issue in sorted(bugs, key=lambda i: i["number"]):
        labeled = [d for d in done if d["name"] == "github_add_labels" and d["input"]["issue_number"] == issue["number"]]
        if not labeled:
            return _tool(n, "github_add_labels", {"repo": repo, "issue_number": issue["number"], "labels": ["bug"]})
        commented = [d for d in done if d["name"] == "github_comment" and d["input"]["issue_number"] == issue["number"]]
        if not commented:
            return _tool(n, "github_comment", {"repo": repo, "issue_number": issue["number"],
                                               "body": "Thanks for the report - labeled as `bug` and queued for triage."})
    return _end(f"Triaged {len(bugs)} bug-like issue(s) out of {len(issues)} open: "
                + ", ".join(f"#{i['number']}" for i in bugs) + ".")


class MockMessages:
    def create(self, *, messages, system=None, tools=None, model=None, max_tokens=None, **_):
        done = _history(messages)
        first = messages[0]["content"]
        text = first if isinstance(first, str) else ""
        names = {t["name"] for t in (tools or [])}
        if "github_list_issues" in names:
            return triage_step(done, text)
        return support_step(done)


class MockClient:
    def __init__(self) -> None:
        self.messages = MockMessages()
