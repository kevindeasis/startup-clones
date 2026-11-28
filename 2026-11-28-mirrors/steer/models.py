"""Pydantic v2 models: trace schema, trigger schema, request/response bodies."""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_TRACE_BYTES = 1_000_000
MAX_MESSAGES = 10_000


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="allow")
    callId: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class Message(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    toolCalls: Optional[list[ToolCall]] = None
    callId: Optional[str] = None
    name: Optional[str] = None

    @field_validator("content", mode="before")
    @classmethod
    def _none_to_empty(cls, v):
        return "" if v is None else v


class TraceUser(BaseModel):
    id: Optional[str] = None
    segment: Optional[str] = None


class Trace(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    conversationId: str
    conversationRevision: int = 1
    entryPoint: str = "chat"
    user: TraceUser = Field(default_factory=TraceUser)
    messages: list[Message]
    turnLatencyMs: Optional[int] = None

    @field_validator("messages")
    @classmethod
    def _limit(cls, v):
        if len(v) > MAX_MESSAGES:
            raise ValueError(f"too many messages (max {MAX_MESSAGES})")
        return v

    def to_dict(self) -> dict:
        return self.model_dump(exclude_none=True)


def _check_regex(p: str) -> str:
    try:
        re.compile(p, re.IGNORECASE)
    except re.error as e:
        raise ValueError(f"invalid regex {p!r}: {e}")
    return p


class MessageMatches(BaseModel):
    type: Literal["message_matches"]
    role: Literal["user", "assistant", "any"] = "any"
    pattern: str
    where: Literal["last", "any"] = "any"

    @field_validator("pattern")
    @classmethod
    def _rx(cls, v):
        return _check_regex(v)


class ToolCalled(BaseModel):
    type: Literal["tool_called"]
    name: str
    min_count: int = Field(default=1, ge=1)


class ToolResultMatches(BaseModel):
    type: Literal["tool_result_matches"]
    name: str
    pattern: str

    @field_validator("pattern")
    @classmethod
    def _rx(cls, v):
        return _check_regex(v)


class UserSegment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type: Literal["user_segment"]
    in_: list[str] = Field(alias="in")


class EntryPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    type: Literal["entry_point"]
    in_: list[str] = Field(alias="in")


class TurnIndexMin(BaseModel):
    type: Literal["turn_index_min"]
    value: int = Field(ge=1)


Condition = Annotated[
    Union[MessageMatches, ToolCalled, ToolResultMatches, UserSegment, EntryPoint, TurnIndexMin],
    Field(discriminator="type"),
]


class Trigger(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    all: list[Condition] = Field(default_factory=list)
    situation: Optional[str] = None
    situation_keywords: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _nonempty(self):
        if not self.all and not self.situation:
            raise ValueError("trigger needs at least one condition or a situation")
        return self

    def to_dict(self) -> dict:
        return self.model_dump(by_alias=True, exclude_none=True)


# ---- request bodies ----
class AgentCreate(BaseModel):
    name: str
    mode: Literal["off", "shadow", "active"] = "shadow"
    system_prompt_hint: str = ""


class AgentPatch(BaseModel):
    name: Optional[str] = None
    mode: Optional[Literal["off", "shadow", "active"]] = None


class Outcome(BaseModel):
    success: bool
    note: str = ""


class CaptureRequest(BaseModel):
    agentId: str
    trace: Trace
    final: bool = False
    terminal: Optional[Literal["completed", "failed", "canceled"]] = None
    outcome: Optional[Outcome] = None


class ContextRequest(BaseModel):
    agentId: str
    trace: Trace
    timeout_ms: int = Field(default=750, ge=1, le=60_000)


class CorrectionCreate(BaseModel):
    agentId: str
    title: str
    guidance: str
    trigger: Trigger


class CorrectionPatch(BaseModel):
    title: Optional[str] = None
    guidance: Optional[str] = None
    trigger: Optional[Trigger] = None


class ActivateRequest(BaseModel):
    holdout_pct: int = Field(default=0, ge=0, le=100)


class DiscoverRequest(BaseModel):
    max_turns: int = Field(default=200, ge=2, le=2000)
