"""Pydantic schemas for structured LLM output and API bodies."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

Category = Literal["hidden_fee", "cancellation_obstacle", "undisclosed_renewal",
                   "fake_urgency", "misleading_ad", "other"]
Priority = Literal["P1", "P2", "P3", "P4"]
CATEGORIES = ["hidden_fee", "cancellation_obstacle", "undisclosed_renewal",
              "fake_urgency", "misleading_ad", "other"]


class Finding(BaseModel):
    category: Category
    severity: Literal["low", "medium", "high"]
    confidence: float = Field(ge=0, le=1)
    title: str
    summary: str
    quote: str = Field(description="Verbatim text from the evidence supporting the finding")
    evidence_kind: str = Field(description="Which evidence item: landing|landing_recheck|checkout|cancel|terms")
    legal_elements: list[str] = Field(description="Rulebook element ids only")


class AnalysisResult(BaseModel):
    business: str
    summary: str
    harm_estimate_cents: int = Field(ge=0)
    priority: Priority
    findings: list[Finding]


class TriageResult(BaseModel):
    business: str
    category: Category
    harm_estimate_cents: int = Field(ge=0)
    priority: Priority
    summary: str


class Letter(BaseModel):
    body: str


class CaseIn(BaseModel):
    target_url: str
    checkout_url: Optional[str] = None
    cancel_url: Optional[str] = None
    business: Optional[str] = None


class DecisionIn(BaseModel):
    action: Literal["warning_letter", "escalate", "needs_more_evidence", "dismiss"]
    note: str = ""


class ComplaintIn(BaseModel):
    text: str = Field(min_length=5)
