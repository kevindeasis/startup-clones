"""Tool schemas + executors. Executors call the twins over HTTP with httpx."""
from __future__ import annotations

import hashlib
import json
from typing import Any

import httpx

STRIPE_KEY = "sk_test_rehearsal"
SLACK_TOKEN = "xoxb-rehearsal"
GITHUB_TOKEN = "ghp_rehearsal"


def _schema(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {"name": name, "description": description,
            "input_schema": {"type": "object", "properties": props, "required": required}}


S = {"type": "string"}
I = {"type": "integer"}

SUPPORT_TOOLS = [
    _schema("slack_read_channel", "Read the most recent messages in a Slack channel (newest first).",
            {"channel_name": S, "limit": I}, ["channel_name"]),
    _schema("slack_post_message", "Post a message to a Slack channel, optionally as a thread reply.",
            {"channel": S, "text": S, "thread_ts": S}, ["channel", "text"]),
    _schema("stripe_find_customer", "Find a Stripe customer by exact email address.", {"email": S}, ["email"]),
    _schema("stripe_list_charges", "List a customer's charges, newest first.",
            {"customer_id": S, "limit": I}, ["customer_id"]),
    _schema("stripe_create_refund", "Refund a charge. Omit amount for a full refund. WRITE operation.",
            {"charge_id": S, "amount": I}, ["charge_id"]),
    _schema("stripe_list_refunds", "List refunds for a charge (use to check state before retrying a write).",
            {"charge_id": S}, ["charge_id"]),
]

TRIAGE_TOOLS = [
    _schema("github_list_issues", "List issues in a repo (owner/name).", {"repo": S, "state": S}, ["repo"]),
    _schema("github_add_labels", "Add labels to an issue. WRITE operation.",
            {"repo": S, "issue_number": I, "labels": {"type": "array", "items": S}}, ["repo", "issue_number", "labels"]),
    _schema("github_comment", "Comment on an issue. WRITE operation.",
            {"repo": S, "issue_number": I, "body": S}, ["repo", "issue_number", "body"]),
]

TOOLS_BY_TASK = {"support": SUPPORT_TOOLS, "triage": TRIAGE_TOOLS}


class ToolExecutor:
    def __init__(self, base: str, env_id: str, idempotency: bool = False, timeout: float = 15.0):
        self.root = f"{base.rstrip('/')}/e/{env_id}"
        self.idempotency = idempotency
        self.http = httpx.Client(timeout=timeout)

    # -- low-level --
    def _send(self, method: str, url: str, headers: dict, **kw) -> tuple[bool, Any]:
        """Returns (ok, parsed-json-or-error-text). ok False on transport errors and any HTTP >= 400."""
        try:
            r = self.http.request(method, url, headers=headers, **kw)
        except httpx.HTTPError as exc:
            return False, f"network error: {type(exc).__name__}: {exc}"
        try:
            data = r.json()
        except ValueError:
            data = r.text
        if r.status_code >= 400:
            return False, f"HTTP {r.status_code}: {r.text[:500]}"
        return True, data

    def _stripe(self, method, path, idem_key=None, **kw):
        h = {"Authorization": f"Bearer {STRIPE_KEY}"}
        if idem_key:
            h["Idempotency-Key"] = idem_key
        return self._send(method, f"{self.root}/stripe/v1{path}", h, **kw)

    def _slack(self, method_name, **data):
        ok, d = self._send("POST", f"{self.root}/slack/api/{method_name}",
                           {"Authorization": f"Bearer {SLACK_TOKEN}"}, data={k: v for k, v in data.items() if v is not None})
        if ok and isinstance(d, dict) and not d.get("ok"):
            return False, f"slack error: {d.get('error')}"
        return ok, d

    def _gh(self, method, path, **kw):
        return self._send(method, f"{self.root}/github{path}", {"Authorization": f"Bearer {GITHUB_TOKEN}"}, **kw)

    # -- tools --
    def execute(self, name: str, args: dict) -> tuple[bool, str]:
        fn = getattr(self, f"t_{name}", None)
        if fn is None:
            return False, f"unknown tool: {name}"
        try:
            ok, data = fn(**args)
        except TypeError as exc:
            return False, f"bad tool input: {exc}"
        return ok, data if isinstance(data, str) else json.dumps(data)

    def t_slack_read_channel(self, channel_name: str, limit: int = 10):
        ok, d = self._slack("conversations.history", channel=channel_name, limit=limit)
        if not ok:
            return ok, d
        return True, [{k: m[k] for k in ("ts", "user", "text", "thread_ts", "channel") if k in m} for m in d["messages"]]

    def t_slack_post_message(self, channel: str, text: str, thread_ts: str | None = None):
        ok, d = self._slack("chat.postMessage", channel=channel, text=text, thread_ts=thread_ts)
        return (True, {"ok": True, "channel": d["channel"], "ts": d["ts"]}) if ok else (ok, d)

    def t_stripe_find_customer(self, email: str):
        ok, d = self._stripe("GET", "/customers", params={"email": email, "limit": 1})
        if not ok:
            return ok, d
        if not d["data"]:
            return False, f"no customer with email {email}"
        c = d["data"][0]
        return True, {"id": c["id"], "email": c["email"], "name": c.get("name")}

    def t_stripe_list_charges(self, customer_id: str, limit: int = 10):
        ok, d = self._stripe("GET", "/charges", params={"customer": customer_id, "limit": limit})
        if not ok:
            return ok, d
        keys = ("id", "amount", "currency", "status", "created", "refunded", "amount_refunded")
        return True, [{k: c.get(k) for k in keys} for c in d["data"]]

    def t_stripe_create_refund(self, charge_id: str, amount: int | None = None):
        data = {"charge": charge_id}
        if amount is not None:
            data["amount"] = str(amount)
        key = hashlib.sha256(f"{charge_id}{amount if amount is not None else ''}".encode()).hexdigest()[:32] \
            if self.idempotency else None
        ok, d = self._stripe("POST", "/refunds", idem_key=key, data=data)
        if not ok:
            return ok, d
        return True, {k: d.get(k) for k in ("id", "amount", "currency", "charge", "status")}

    def t_stripe_list_refunds(self, charge_id: str):
        ok, d = self._stripe("GET", "/refunds", params={"charge": charge_id})
        if not ok:
            return ok, d
        return True, [{k: r.get(k) for k in ("id", "amount", "charge", "status")} for r in d["data"]]

    def t_github_list_issues(self, repo: str, state: str = "open"):
        ok, d = self._gh("GET", f"/repos/{repo}/issues", params={"state": state})
        if not ok:
            return ok, d
        return True, [{"number": i["number"], "title": i["title"], "body": i.get("body"),
                       "labels": [lb["name"] for lb in i["labels"]]} for i in d]

    def t_github_add_labels(self, repo: str, issue_number: int, labels: list[str]):
        ok, d = self._gh("POST", f"/repos/{repo}/issues/{issue_number}/labels", json={"labels": labels})
        return (True, [lb["name"] for lb in d]) if ok else (ok, d)

    def t_github_comment(self, repo: str, issue_number: int, body: str):
        ok, d = self._gh("POST", f"/repos/{repo}/issues/{issue_number}/comments", json={"body": body})
        return (True, {"id": d["id"]}) if ok else (ok, d)
