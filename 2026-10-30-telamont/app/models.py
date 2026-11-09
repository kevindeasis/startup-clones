from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.now(timezone.utc)


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=now)


class Document(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    filename: str
    kind: str = "other"  # contract|spec|drawing|schedule|other
    page_count: int = 0
    char_count: int = 0
    status: str = "uploaded"  # uploaded|extracted|failed
    message: Optional[str] = None  # failure reason (extra field)
    created_at: datetime = Field(default_factory=now)


class Chunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="document.id", index=True)
    page: int
    idx: int
    text: str


class Risk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    title: str
    category: str  # contradiction|contractual|technical|compliance
    severity: str  # high|medium|low
    description: str = ""
    recommendation: str = ""
    status: str = "open"  # open|in_review|resolved|dismissed
    owner: Optional[str] = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class Citation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    risk_id: int = Field(foreign_key="risk.id", index=True)
    document_id: int = Field(foreign_key="document.id")
    page: int
    quote: str


class Question(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    question: str
    answer: str
    citations_json: str = "[]"
    created_at: datetime = Field(default_factory=now)
