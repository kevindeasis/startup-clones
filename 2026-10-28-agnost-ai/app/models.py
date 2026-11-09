from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    first_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    messages = relationship("Message", back_populates="conversation", order_by="Message.idx", cascade="all, delete-orphan")
    analysis = relationship("ConversationAnalysis", back_populates="conversation", uselist=False, cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String)
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    conversation = relationship("Conversation", back_populates="messages")


class ConversationAnalysis(Base):
    __tablename__ = "conversation_analyses"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), primary_key=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    intent: Mapped[str] = mapped_column(String, default="")
    outcome: Mapped[str] = mapped_column(String, default="unresolved", index=True)
    sentiment: Mapped[str] = mapped_column(String, default="neutral")
    frustration_score: Mapped[float] = mapped_column(Float, default=0.0)
    signals_json: Mapped[str] = mapped_column(Text, default="{}")
    feature_requests_json: Mapped[str] = mapped_column(Text, default="[]")
    bug_reports_json: Mapped[str] = mapped_column(Text, default="[]")
    model: Mapped[str] = mapped_column(String, default="mock")
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    has_frustration: Mapped[bool] = mapped_column(Boolean, default=False)
    has_rephrasing: Mapped[bool] = mapped_column(Boolean, default=False)
    has_correction: Mapped[bool] = mapped_column(Boolean, default=False)
    has_feature_request: Mapped[bool] = mapped_column(Boolean, default=False)
    has_bug_report: Mapped[bool] = mapped_column(Boolean, default=False)
    has_hallucination: Mapped[bool] = mapped_column(Boolean, default=False)
    has_churn_signal: Mapped[bool] = mapped_column(Boolean, default=False)
    silent_failure: Mapped[bool] = mapped_column(Boolean, default=False)
    conversation = relationship("Conversation", back_populates="analysis")


class Pattern(Base):
    __tablename__ = "patterns"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String, index=True)  # cluster | feature_requests | bugs | custom
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text, default="")
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    top_terms_json: Mapped[str] = mapped_column(Text, default="[]")
    conversation_count: Mapped[int] = mapped_column(Integer, default=0)
    user_count: Mapped[int] = mapped_column(Integer, default=0)
    frustrated_pct: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    members = relationship("PatternMember", back_populates="pattern", cascade="all, delete-orphan")


class PatternMember(Base):
    __tablename__ = "pattern_members"
    __table_args__ = (UniqueConstraint("pattern_id", "conversation_id", "group_text"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    pattern_id: Mapped[int] = mapped_column(ForeignKey("patterns.id"), index=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    score: Mapped[float] = mapped_column(Float, default=1.0)
    group_text: Mapped[str | None] = mapped_column(String, nullable=True)
    pattern = relationship("Pattern", back_populates="members")
