"""Pydantic request/response models."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Policy = Literal["hold", "escalate", "deliver"]


class ScoreRequest(BaseModel):
    prompt: str
    answer: str
    sources: list[str] = Field(default_factory=list)
    policy: Policy = "deliver"


class ScoreResponse(BaseModel):
    id: str
    score: float
    flagged: bool
    threshold: float
    risky_sentence: Optional[str] = None
    source_sentence: Optional[str] = None
    failure_type: str
    explanation: str
    action: str
    final_answer: str
    latency_ms: int


class ChatRequest(BaseModel):
    question: str
    sources: list[str] = Field(default_factory=list)
    policy: Policy = "hold"
    answer_override: Optional[str] = Field(
        default=None, description="Skip the base model and guard this answer (demo presets)."
    )


class ChatResponse(BaseModel):
    question: str
    raw_answer: str
    guarded: ScoreResponse


class ReviewRequest(BaseModel):
    id: str
    decision: Literal["confirmed", "cleared"]
