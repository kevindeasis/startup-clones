"""Pydantic v2 models for every structured LLM output plus the final evidence file."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ---- Step 2: extract_facts -------------------------------------------------
class Party(BaseModel):
    name: str
    role: str = ""


class DateFact(BaseModel):
    date: str = Field(description="ISO date YYYY-MM-DD when possible")
    event: str
    quote: str = Field(max_length=200)


class AmountFact(BaseModel):
    amount: float
    currency: str = "USD"
    what: str
    quote: str = Field(max_length=200)


class Assertion(BaseModel):
    text: str
    quote: str = Field(max_length=200)
    speaker: str = ""


class DocumentFacts(BaseModel):
    summary: str
    parties: list[Party] = []
    dates: list[DateFact] = []
    amounts: list[AmountFact] = []
    assertions: list[Assertion] = []
    locations: list[str] = []


# ---- Step 3: timeline ------------------------------------------------------
class TimelineEvent(BaseModel):
    date: str
    event: str
    document_id: str
    quote: str = Field(max_length=200)
    confidence: float = Field(default=0.8, ge=0, le=1)


class Timeline(BaseModel):
    events: list[TimelineEvent]
    gaps_or_anomalies: list[str] = []


# ---- Step 4: inconsistencies ----------------------------------------------
class Citation(BaseModel):
    document_id: str
    quote: str = Field(max_length=200)


class Inconsistency(BaseModel):
    title: str
    severity: Literal["low", "medium", "high"]
    claim_a: Citation
    claim_b: Citation
    explanation: str


class Corroboration(BaseModel):
    fact: str
    document_ids: list[str]


class InconsistencyReport(BaseModel):
    inconsistencies: list[Inconsistency]
    corroborations: list[Corroboration] = []


# ---- Step 5: coverage ------------------------------------------------------
class Clause(BaseModel):
    clause_quote: str = Field(max_length=300)
    document_id: str
    effect: Literal["grants", "excludes", "limits", "condition"]


class CoveragePosition(BaseModel):
    position: Literal["covered", "not_covered", "partially_covered", "unclear"]
    clauses: list[Clause] = []
    rationale: str
    open_questions: list[str] = []


# ---- Step 6: risk_and_actions ---------------------------------------------
class RecommendedAction(BaseModel):
    action: str
    priority: Literal["now", "soon", "later"]
    why: str


class RiskAssessment(BaseModel):
    score: int = Field(ge=0, le=100)
    band: Literal["low", "medium", "high", "critical"]
    rationale: list[str]
    recommended_actions: list[RecommendedAction]
    executive_summary: str


# ---- Forensics -------------------------------------------------------------
class ForensicFlag(BaseModel):
    document_id: str = ""
    flag: str
    severity: Literal["info", "low", "medium", "high"]
    detail: str


def band_for(score: int) -> str:
    if score < 25:
        return "low"
    if score < 50:
        return "medium"
    if score < 75:
        return "high"
    return "critical"
