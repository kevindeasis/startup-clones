from typing import Literal, Optional

from pydantic import BaseModel, Field


class MessageIn(BaseModel):
    conversation_id: str
    user_id: Optional[str] = None
    role: Literal["user", "assistant", "tool", "system"]
    content: str
    timestamp: Optional[str] = None
    metadata: Optional[dict] = None


class IngestRequest(BaseModel):
    messages: list[MessageIn]


class CustomPatternIn(BaseModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)


class Signals(BaseModel):
    frustration: bool = False
    repeated_rephrasing: bool = False
    correction: bool = False
    hallucination_suspected: bool = False
    churn_signal: bool = False
    silent_failure: bool = False


class AnalysisResult(BaseModel):
    """Strict schema the LLM must return (spec section 6)."""
    summary: str
    intent: str
    outcome: Literal["resolved", "partial", "unresolved", "abandoned"]
    sentiment: Literal["positive", "neutral", "negative"] = "neutral"
    frustration_score: float = Field(default=0.0, ge=0.0, le=1.0)
    signals: Signals = Field(default_factory=Signals)
    feature_requests: list[str] = Field(default_factory=list)
    bug_reports: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)


class ClusterName(BaseModel):
    name: str
    description: str = ""


class ClassifyResult(BaseModel):
    match: bool
    confidence: float = 0.0
    reason: str = ""
