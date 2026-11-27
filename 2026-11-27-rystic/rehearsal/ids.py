"""Vendor-shaped, deterministic id generators (derived from env.rng_seed + counters)."""
from __future__ import annotations

import random
import string

from .envs import Env

BASE62 = string.ascii_letters + string.digits
UPPER_ALNUM = string.ascii_uppercase + string.digits


def _draw(env: Env, kind: str, alphabet: str, n: int) -> str:
    counter = env.next(f"id.{kind}")
    rnd = random.Random(f"{env.rng_seed}:{kind}:{counter}")
    return "".join(rnd.choice(alphabet) for _ in range(n))


def stripe_id(env: Env, prefix: str) -> str:
    """cus_ / pi_ / ch_ / re_ + 14 base62 chars."""
    return f"{prefix}_{_draw(env, prefix, BASE62, 14)}"


def slack_channel_id(env: Env) -> str:
    return "C" + _draw(env, "slack_channel", UPPER_ALNUM, 10)


def slack_user_id(env: Env) -> str:
    return "U" + _draw(env, "slack_user", UPPER_ALNUM, 10)


def slack_ts(env: Env) -> str:
    return f"{env.epoch()}.{env.next('slack.ts'):06d}"


def github_issue_number(env: Env, repo: str) -> int:
    nums = [r["number"] for r in env.registers.get("github.issues", {}).values() if r.get("repo") == repo]
    return max(nums, default=0) + 1


def github_object_id(env: Env, kind: str) -> int:
    return 1000 + env.next(f"gh.{kind}")
