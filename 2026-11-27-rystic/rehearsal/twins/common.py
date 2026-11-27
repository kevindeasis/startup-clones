"""Helpers shared by the twins: error type, parameter parsing, auth, env lookup."""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import parse_qsl

from fastapi import Request

from ..envs import Env


class TwinError(Exception):
    def __init__(self, status: int, body: dict, headers: dict | None = None):
        self.status, self.body, self.headers = status, body, headers or {}


def lookup_env(request: Request, env_id: str) -> Env:
    env = request.app.state.registry.get(env_id)
    if env is None:
        raise TwinError(404, {"error": "env_not_found", "message": f"No such env: {env_id}"})
    return env


_KEY = re.compile(r"^([^\[\]]+)((?:\[[^\]]*\])*)$")


def _nest(data: dict, key: str, value: Any) -> None:
    m = _KEY.match(key)
    if not m or not m.group(2):
        data[key] = value
        return
    parts = [m.group(1)] + re.findall(r"\[([^\]]*)\]", m.group(2))
    cur = data
    for i, p in enumerate(parts[:-1]):
        nxt = parts[i + 1]
        if p not in cur or not isinstance(cur[p], (dict, list)):
            cur[p] = [] if nxt == "" else {}
        if isinstance(cur[p], list):
            if nxt == "":
                cur[p].append(value)
                return
            return
        cur = cur[p]
    cur[parts[-1]] = value


async def get_params(request: Request) -> dict[str, Any]:
    """Merge query string with a form-encoded or JSON body (Stripe bracket notation supported)."""
    data: dict[str, Any] = {}
    body = await request.body()
    if body and "json" in request.headers.get("content-type", ""):
        try:
            j = json.loads(body)
        except ValueError:
            j = None
        if isinstance(j, dict):
            data.update(j)
        elif isinstance(j, list):
            data["_list"] = j
    elif body:
        for k, v in parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True):
            _nest(data, k, v)
    for k, v in request.query_params.multi_items():
        _nest(data, k, v)
    return data


def to_int(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def match_where(rec: dict, where: dict) -> bool:
    for path, want in where.items():
        cur: Any = rec
        for part in str(path).split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        if cur != want:
            return False
    return True
