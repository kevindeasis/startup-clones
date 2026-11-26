from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class Filter(BaseModel):
    dimension: str
    op: Literal["=", "!=", "in"]
    value: str | list[str]


class TimeRange(BaseModel):
    start: date  # inclusive
    end: date  # exclusive


class Interpretation(BaseModel):
    metric: str = ""
    group_by: list[str] = Field(default_factory=list)
    filters: list[Filter] = Field(default_factory=list)
    time_range: TimeRange | None = None
    cannot_answer: str | None = None


class AskRequest(BaseModel):
    question: str


class VerifyRequest(BaseModel):
    sql: str
    metric: str
