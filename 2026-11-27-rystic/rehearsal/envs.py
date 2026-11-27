"""Env registry and the per-env in-memory data model."""
from __future__ import annotations

import contextvars
import copy
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field

# Mutations touched by the request currently being served (set by the fault middleware).
CUR_MUT: contextvars.ContextVar[list | None] = contextvars.ContextVar("cur_mut", default=None)


class RateLimit(BaseModel):
    requests_per_minute: int = Field(60, ge=1)


class DropAfterWrite(BaseModel):
    service: str = "stripe"
    path_glob: str = "*"
    count: int = Field(1, ge=0)
    dropped: int = 0  # internal counter of how many were already dropped


class NetworkProfile(BaseModel):
    enabled: bool = False
    latency_ms: int = Field(0, ge=0)
    jitter_ms: int = Field(0, ge=0)
    refuse_fraction: float = Field(0.0, ge=0.0, le=1.0)
    rate_limit: RateLimit | None = None
    drop_after_write: DropAfterWrite | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Env:
    env_id: str
    created_at: str = field(default_factory=lambda: iso(utcnow()))
    rng_seed: int = 0
    pinned: datetime | None = None
    offset_seconds: int = 0
    sequences: dict[str, int] = field(default_factory=dict)
    registers: dict[str, dict[str, Any]] = field(default_factory=dict)
    network: NetworkProfile = field(default_factory=NetworkProfile)
    ledger: list[dict] = field(default_factory=list)
    egress: list[dict] = field(default_factory=list)
    snapshots: dict[str, dict] = field(default_factory=dict)
    boot: dict[str, Any] = field(default_factory=dict)
    rate_window: list[float] = field(default_factory=list)

    # ---- clock ----
    def now(self) -> datetime:
        return (self.pinned or utcnow()) + timedelta(seconds=self.offset_seconds)

    def now_iso(self) -> str:
        return iso(self.now())

    def epoch(self) -> int:
        return int(self.now().timestamp())

    def set_time(self, value: str) -> None:
        self.pinned = parse_time(value)
        self.offset_seconds = 0

    def advance(self, seconds: int) -> None:
        self.offset_seconds += int(seconds)

    # ---- sequences / state ----
    def next(self, name: str) -> int:
        self.sequences[name] = self.sequences.get(name, 0) + 1
        return self.sequences[name]

    def reg(self, register: str) -> dict[str, Any]:
        return self.registers.setdefault(register, {})

    def put(self, register: str, key: str, record: Any) -> None:
        self.reg(register)[key] = record
        muts = CUR_MUT.get()
        if muts is not None:
            muts.append(f"{register}:{key}")

    def delete(self, register: str, key: str) -> None:
        self.reg(register).pop(key, None)
        muts = CUR_MUT.get()
        if muts is not None:
            muts.append(f"{register}:{key}")

    def emit(self, service: str, type_: str, payload: dict) -> None:
        self.egress.append(
            {"seq": len(self.egress) + 1, "t": self.now_iso(), "service": service,
             "type": type_, "payload": copy.deepcopy(payload)}
        )

    def clear(self) -> None:
        self.pinned = None
        self.offset_seconds = 0
        self.sequences.clear()
        self.registers.clear()
        self.network = NetworkProfile()
        self.ledger.clear()
        self.egress.clear()
        self.rate_window.clear()

    # ---- snapshots ----
    def snapshot(self) -> str:
        sid = "snap_" + uuid.uuid4().hex[:10]
        data = {
            "registers": copy.deepcopy(self.registers),
            "pinned": iso(self.pinned) if self.pinned else None,
            "offset_seconds": self.offset_seconds,
            "sequences": dict(self.sequences),
            "network": self.network.model_dump(),
            "ledger_len": len(self.ledger),
            "egress_len": len(self.egress),
        }
        self.snapshots[sid] = data
        persist_dir = os.environ.get("REHEARSAL_PERSIST_DIR", ".rehearsal")
        try:  # best effort, snapshots also live in memory
            os.makedirs(persist_dir, exist_ok=True)
            with open(os.path.join(persist_dir, f"{self.env_id}-{sid}.json"), "w") as fh:
                json.dump(data, fh)
        except OSError:
            pass
        return sid

    def restore(self, sid: str) -> bool:
        data = self.snapshots.get(sid)
        if data is None:
            return False
        self.registers = copy.deepcopy(data["registers"])
        self.pinned = parse_time(data["pinned"]) if data["pinned"] else None
        self.offset_seconds = data["offset_seconds"]
        self.sequences = dict(data["sequences"])
        self.network = NetworkProfile.model_validate(data["network"])
        del self.ledger[data["ledger_len"]:]
        del self.egress[data["egress_len"]:]
        return True

    def inspect(self, register: str | None = None) -> dict:
        regs = self.registers if register is None else {register: self.registers.get(register, {})}
        return {
            "env_id": self.env_id,
            "registers": regs,
            "sequences": self.sequences,
            "clock": {"now": self.now_iso(), "pinned": iso(self.pinned) if self.pinned else None,
                      "offset_seconds": self.offset_seconds},
        }


class Registry:
    def __init__(self) -> None:
        self.envs: dict[str, Env] = {}

    def create(self) -> Env:
        env = Env(env_id="env_" + uuid.uuid4().hex[:8])
        self.envs[env.env_id] = env
        return env

    def get(self, env_id: str) -> Env | None:
        return self.envs.get(env_id)

    def delete(self, env_id: str) -> bool:
        return self.envs.pop(env_id, None) is not None
