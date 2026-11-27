"""Slack twin: /e/{env_id}/slack/api/<method> (always HTTP 200 for API-level errors, like Slack)."""
from __future__ import annotations

import copy
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..envs import Env
from ..ids import slack_channel_id, slack_ts
from .common import TwinError, get_params, lookup_env, to_int

router = APIRouter(prefix="/e/{env_id}/slack/api")
BOT_USER = "U0REHEARSAL"


class SlackError(Exception):
    def __init__(self, code: str):
        self.code = code


def dep(request: Request, env_id: str) -> Env:
    env = lookup_env(request, env_id)
    auth = request.headers.get("authorization", "")
    token = auth.split(" ", 1)[-1].strip()
    if not auth:
        raise TwinError(200, {"ok": False, "error": "not_authed"})
    if not token.startswith("xoxb-"):
        raise TwinError(200, {"ok": False, "error": "invalid_auth"})
    return env


def find_channel(env: Env, ref: str | None) -> dict:
    if not ref:
        raise SlackError("channel_not_found")
    chans = env.reg("slack.channels")
    if ref in chans:
        return chans[ref]
    name = ref.lstrip("#")
    for c in chans.values():
        if c["name"] == name:
            return c
    raise SlackError("channel_not_found")


def msgs(env: Env, channel_id: str) -> list[dict]:
    return [m for m in env.reg("slack.messages").values() if m["channel"] == channel_id]


def msg_key(m: dict) -> str:
    return f"{m['channel']}:{m['ts']}"


# ---- method handlers: (env, params) -> dict (without "ok") ----
def auth_test(env, p):
    return {"url": "http://rehearsal.local/", "team": "Acme", "user": "rehearsal-bot", "team_id": "T0ACME001",
            "user_id": BOT_USER, "bot_id": "B0REHEARSAL"}


def conversations_list(env, p):
    return {"channels": copy.deepcopy(list(env.reg("slack.channels").values())),
            "response_metadata": {"next_cursor": ""}}


def conversations_create(env, p):
    name = (p.get("name") or "").lstrip("#").lower()
    if not name:
        raise SlackError("invalid_name_required")
    if any(c["name"] == name for c in env.reg("slack.channels").values()):
        raise SlackError("name_taken")
    cid = slack_channel_id(env)
    rec = {"id": cid, "name": name, "is_channel": True, "is_archived": False, "created": env.epoch(), "num_members": 1}
    env.put("slack.channels", cid, rec)
    return {"channel": rec}


def conversations_info(env, p):
    return {"channel": find_channel(env, p.get("channel"))}


def conversations_history(env, p):
    ch = find_channel(env, p.get("channel"))
    oldest = float(p.get("oldest") or 0)
    rows = [m for m in msgs(env, ch["id"]) if (not m.get("thread_ts") or m["thread_ts"] == m["ts"]) and float(m["ts"]) > oldest]
    rows.sort(key=lambda m: float(m["ts"]), reverse=True)
    limit = to_int(p.get("limit")) or 100
    return {"messages": copy.deepcopy(rows[:limit]), "has_more": len(rows) > limit}


def conversations_replies(env, p):
    ch = find_channel(env, p.get("channel"))
    ts = p.get("ts")
    parent = env.reg("slack.messages").get(f"{ch['id']}:{ts}")
    if not parent:
        raise SlackError("thread_not_found")
    rows = [parent] + [m for m in msgs(env, ch["id"]) if m.get("thread_ts") == ts and m["ts"] != ts]
    rows.sort(key=lambda m: float(m["ts"]))
    return {"messages": copy.deepcopy(rows), "has_more": False}


def chat_post_message(env, p):
    ch = find_channel(env, p.get("channel"))
    text = p.get("text")
    if not text:
        raise SlackError("no_text")
    ts = slack_ts(env)
    m: dict[str, Any] = {"type": "message", "user": BOT_USER, "text": text, "ts": ts, "channel": ch["id"],
                         "bot_id": "B0REHEARSAL"}
    if p.get("thread_ts"):
        m["thread_ts"] = str(p["thread_ts"])
    env.put("slack.messages", msg_key(m), m)
    env.emit("slack", "slack.message_posted", {"channel": ch["id"], "ts": ts, "text": text,
                                               "thread_ts": m.get("thread_ts")})
    return {"channel": ch["id"], "ts": ts, "message": copy.deepcopy(m)}


def _get_msg(env, p, ts_param="ts"):
    ch = find_channel(env, p.get("channel"))
    m = env.reg("slack.messages").get(f"{ch['id']}:{p.get(ts_param)}")
    if not m:
        raise SlackError("message_not_found")
    return ch, m


def chat_update(env, p):
    ch, m = _get_msg(env, p)
    if not p.get("text"):
        raise SlackError("no_text")
    m["text"] = p["text"]
    m["edited"] = {"user": BOT_USER, "ts": slack_ts(env)}
    env.put("slack.messages", msg_key(m), m)
    return {"channel": ch["id"], "ts": m["ts"], "text": m["text"]}


def chat_delete(env, p):
    ch, m = _get_msg(env, p)
    env.delete("slack.messages", msg_key(m))
    return {"channel": ch["id"], "ts": m["ts"]}


def reactions_add(env, p):
    ch, m = _get_msg(env, p, "timestamp")
    name = p.get("name")
    if not name:
        raise SlackError("invalid_name")
    key = f"{ch['id']}:{m['ts']}:{name}"
    if key in env.reg("slack.reactions"):
        raise SlackError("already_reacted")
    env.put("slack.reactions", key, {"channel": ch["id"], "ts": m["ts"], "name": name, "user": BOT_USER})
    return {}


def users_list(env, p):
    return {"members": copy.deepcopy(list(env.reg("slack.users").values())), "response_metadata": {"next_cursor": ""}}


def users_info(env, p):
    u = env.reg("slack.users").get(p.get("user", ""))
    if not u:
        raise SlackError("user_not_found")
    return {"user": copy.deepcopy(u)}


def users_lookup_by_email(env, p):
    for u in env.reg("slack.users").values():
        if u.get("profile", {}).get("email") == p.get("email"):
            return {"user": copy.deepcopy(u)}
    raise SlackError("users_not_found")


METHODS: dict[str, Callable] = {
    "auth.test": auth_test, "conversations.list": conversations_list, "conversations.create": conversations_create,
    "conversations.info": conversations_info, "conversations.history": conversations_history,
    "conversations.replies": conversations_replies, "chat.postMessage": chat_post_message,
    "chat.update": chat_update, "chat.delete": chat_delete, "reactions.add": reactions_add,
    "users.list": users_list, "users.info": users_info, "users.lookupByEmail": users_lookup_by_email,
}


@router.api_route("/{method}", methods=["GET", "POST"])
async def call(method: str, request: Request, env: Env = Depends(dep)):
    fn = METHODS.get(method)
    if fn is None:
        return JSONResponse({"ok": False, "error": "unknown_method"})
    p = await get_params(request)
    try:
        return JSONResponse({"ok": True, **fn(env, p)})
    except SlackError as e:
        return JSONResponse({"ok": False, "error": e.code})
