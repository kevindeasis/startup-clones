"""Seed validation + normalisation into vendor-shaped records."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from .envs import Env, iso


class SeedError(ValueError):
    pass


def to_epoch(v: Any) -> int:
    if isinstance(v, bool):
        raise SeedError(f"invalid timestamp: {v!r}")
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, datetime):
        dt = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    if isinstance(v, str):
        try:
            return int(v)
        except ValueError:
            pass
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError as exc:
            raise SeedError(f"invalid timestamp: {v!r}") from exc
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    raise SeedError(f"invalid timestamp: {v!r}")


def to_iso(v: Any) -> str:
    return iso(datetime.fromtimestamp(to_epoch(v), tz=timezone.utc))


def _need_int(rec: dict, name: str, where: str) -> int:
    v = rec.get(name)
    if isinstance(v, bool) or not isinstance(v, int):
        raise SeedError(f"{where}: '{name}' must be an integer")
    return v


def gh_label(v: Any) -> dict:
    if isinstance(v, str):
        return {"name": v, "color": "ededed"}
    if isinstance(v, dict) and v.get("name"):
        return {"name": v["name"], "color": v.get("color", "ededed"), **{k: x for k, x in v.items() if k not in ("name", "color")}}
    raise SeedError(f"invalid label: {v!r}")


def gh_user(v: Any) -> dict:
    if isinstance(v, dict):
        return v
    return {"login": v or "octocat", "id": 1, "type": "User"}


def normalize(env: Env, register: str, key: str, rec: dict) -> dict:
    where = f"{register}[{key}]"
    r = copy.deepcopy(rec)
    now = env.epoch()
    if register == "stripe.customers":
        r.setdefault("id", key)
        r.update(object="customer", created=to_epoch(r.get("created", now)))
        r.setdefault("email", None); r.setdefault("name", None)
        r.setdefault("metadata", {}); r.setdefault("livemode", False)
    elif register == "stripe.charges":
        r.setdefault("id", key)
        _need_int(r, "amount", where)
        r.update(object="charge", created=to_epoch(r.get("created", now)))
        r.setdefault("currency", "usd"); r.setdefault("customer", None)
        r.setdefault("status", "succeeded"); r.setdefault("paid", True)
        r.setdefault("amount_refunded", 0); r.setdefault("payment_intent", None)
        r.setdefault("metadata", {}); r.setdefault("livemode", False)
        r["refunded"] = r["amount_refunded"] >= r["amount"] and r["amount"] > 0
    elif register == "stripe.payment_intents":
        r.setdefault("id", key)
        _need_int(r, "amount", where)
        r.update(object="payment_intent", created=to_epoch(r.get("created", now)))
        r.setdefault("currency", "usd"); r.setdefault("customer", None)
        r.setdefault("status", "requires_confirmation"); r.setdefault("latest_charge", None)
        r.setdefault("metadata", {})
    elif register == "stripe.refunds":
        r.setdefault("id", key)
        _need_int(r, "amount", where)
        r.update(object="refund", created=to_epoch(r.get("created", now)))
        r.setdefault("currency", "usd"); r.setdefault("status", "succeeded")
        r.setdefault("charge", None); r.setdefault("payment_intent", None); r.setdefault("metadata", {})
    elif register == "stripe.idempotency_keys":
        pass
    elif register == "slack.users":
        r.setdefault("id", key)
        r.setdefault("name", key.lower())
        r.setdefault("real_name", r["name"])
        r.setdefault("profile", {}); r.setdefault("is_bot", False); r.setdefault("deleted", False)
    elif register == "slack.channels":
        r.setdefault("id", key)
        if not r.get("name"):
            raise SeedError(f"{where}: 'name' is required")
        r.update(is_channel=True, is_archived=r.get("is_archived", False), created=to_epoch(r.get("created", now)))
        r.setdefault("num_members", 1)
    elif register == "slack.messages":
        if ":" not in key:
            raise SeedError(f"{where}: key must be 'channel:ts'")
        ch, ts = key.split(":", 1)
        r.update(type="message", channel=ch, ts=ts)
        if not isinstance(r.get("text", ""), str):
            raise SeedError(f"{where}: 'text' must be a string")
        r.setdefault("text", "")
    elif register == "slack.reactions":
        r.setdefault("name", key.rsplit(":", 1)[-1])
    elif register == "github.repos":
        if "/" not in key:
            raise SeedError(f"{where}: key must be 'owner/name'")
        owner, name = key.split("/", 1)
        r.update(name=name, full_name=key, owner={"login": owner, "id": 1, "type": "User"})
        r.setdefault("private", False); r.setdefault("default_branch", "main")
        r.setdefault("id", 100 + env.next("gh.repo")); r.setdefault("created_at", env.now_iso())
        r.setdefault("description", None)
    elif register == "github.issues":
        if "#" not in key or "/" not in key:
            raise SeedError(f"{where}: key must be 'owner/name#number'")
        repo, num = key.rsplit("#", 1)
        if not num.isdigit():
            raise SeedError(f"{where}: issue number must be numeric")
        if not r.get("title"):
            raise SeedError(f"{where}: 'title' is required")
        r.update(number=int(num), repo=repo)
        r.setdefault("id", 5000 + env.next("gh.issue_id"))
        r.setdefault("state", "open")
        if r["state"] not in ("open", "closed"):
            raise SeedError(f"{where}: state must be open|closed")
        r.setdefault("body", None)
        r["labels"] = [gh_label(x) for x in r.get("labels", [])]
        r["user"] = gh_user(r.get("user"))
        r["created_at"] = to_iso(r["created_at"]) if "created_at" in r else env.now_iso()
        r["updated_at"] = r["created_at"]; r.setdefault("closed_at", None)
    elif register == "github.comments":
        r.setdefault("id", 9000 + env.next("gh.comment_id"))
        if not r.get("repo") or not r.get("issue_number"):
            raise SeedError(f"{where}: 'repo' and 'issue_number' are required")
        r["user"] = gh_user(r.get("user")); r.setdefault("body", "")
        r["created_at"] = to_iso(r["created_at"]) if "created_at" in r else env.now_iso()
    elif register == "github.labels":
        r.setdefault("name", key.split(":", 1)[-1]); r.setdefault("color", "ededed")
        r.setdefault("id", 7000 + env.next("gh.label_id"))
    else:
        raise SeedError(f"unknown register: {register}")
    return r


KNOWN_REGISTERS = {
    "stripe.customers", "stripe.charges", "stripe.payment_intents", "stripe.refunds", "stripe.idempotency_keys",
    "slack.users", "slack.channels", "slack.messages", "slack.reactions",
    "github.repos", "github.issues", "github.comments", "github.labels",
}


def seed_env(env: Env, seed: Any) -> None:
    """Validate everything first, then write. Raises SeedError and writes nothing on failure."""
    if not isinstance(seed, dict):
        raise SeedError("seed must be an object mapping register -> {key: record}")
    staged: list[tuple[str, str, dict]] = []
    saved_seq = dict(env.sequences)
    try:
        for register, rows in seed.items():
            if register not in KNOWN_REGISTERS:
                raise SeedError(f"unknown register: {register}")
            if not isinstance(rows, dict):
                raise SeedError(f"{register}: must be an object of key -> record")
            for key, rec in rows.items():
                if not isinstance(rec, dict):
                    raise SeedError(f"{register}[{key}]: record must be an object")
                staged.append((register, str(key), normalize(env, register, str(key), rec)))
    except SeedError:
        env.sequences = saved_seq
        raise
    for register, key, rec in staged:
        env.put(register, key, rec)
