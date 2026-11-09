"""SQLModel tables plus the Pydantic schema the LLM must return."""
from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from typing import Optional

from pydantic import BaseModel, Field as PField, NaiveDatetime
from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


class Customer(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    contact_emails: str = ""
    contact_phones: str = ""
    notes: str = ""
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class Product(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sku: str = Field(index=True, unique=True)
    name: str
    unit: str = "lb"
    pack_size: str = ""
    category: str = ""
    aliases: str = ""
    active: bool = True

    def alias_list(self) -> list[str]:
        return [a.strip() for a in self.aliases.split(",") if a.strip()]


class CustomerAlias(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("customer_id", "raw_text_normalized"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    customer_id: int = Field(foreign_key="customer.id", index=True)
    raw_text_normalized: str
    sku: str
    created_at: NaiveDatetime = Field(default_factory=utcnow)


class InboundMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    channel: str = "email"  # email | sms | photo | pdf
    sender: str = ""
    subject: str = ""
    body_text: str = ""
    attachment_path: Optional[str] = None
    attachment_kind: Optional[str] = None  # image | pdf | eml
    received_at: NaiveDatetime = Field(default_factory=utcnow)


class DraftOrder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(foreign_key="inboundmessage.id")
    customer_id: Optional[int] = Field(default=None, foreign_key="customer.id")
    inferred_customer_name: Optional[str] = None
    delivery_date: Optional[dt.date] = None
    status: str = "needs_review"  # needs_review|auto_approved|pushed|rejected
    llm_notes: str = ""
    llm_questions: str = "[]"  # JSON list
    llm_provider: str = ""
    llm_model: str = ""
    created_at: NaiveDatetime = Field(default_factory=utcnow)
    pushed_at: Optional[NaiveDatetime] = None

    def questions(self) -> list[str]:
        try:
            return list(json.loads(self.llm_questions or "[]"))
        except ValueError:
            return []


class DraftLine(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    draft_id: int = Field(foreign_key="draftorder.id", index=True)
    raw_text: str = ""
    qty: Optional[float] = None
    unit: Optional[str] = None
    product_text: str = ""
    sku: Optional[str] = None
    product_id: Optional[int] = Field(default=None, foreign_key="product.id")
    confidence: float = 0.0
    candidates: str = "[]"  # JSON list of {sku,name,score}
    source: str = "message"  # message | history
    flag: Optional[str] = None
    note: Optional[str] = None

    def candidate_list(self) -> list[dict]:
        try:
            return list(json.loads(self.candidates or "[]"))
        except ValueError:
            return []


class ErpOrder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    erp_number: str = Field(index=True)
    customer_id: int = Field(foreign_key="customer.id")
    delivery_date: Optional[dt.date] = None
    created_at: NaiveDatetime = Field(default_factory=utcnow)
    draft_id: Optional[int] = Field(default=None, foreign_key="draftorder.id")


class ErpOrderLine(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    erp_order_id: int = Field(foreign_key="erporder.id", index=True)
    sku: str
    qty: float
    unit: str = ""
    description: str = ""


class RepSummary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    draft_id: int = Field(foreign_key="draftorder.id", index=True)
    text: str
    created_at: NaiveDatetime = Field(default_factory=utcnow)


# ---------------------------------------------------------------- LLM schema
class ExtractedLine(BaseModel):
    raw_text: str
    qty: Optional[float] = None
    unit: Optional[str] = None
    product_text: str
    note: Optional[str] = None


class ExtractedOrder(BaseModel):
    customer_name_hint: Optional[str] = None
    delivery_date_hint: Optional[str] = None
    delivery_date: Optional[str] = PField(default=None, description="ISO date YYYY-MM-DD")
    repeat_reference: Optional[str] = None
    lines: list[ExtractedLine] = PField(default_factory=list)
    questions: list[str] = PField(default_factory=list)
    language: str = "en"


@dataclass
class PipelineContext:
    """Everything the LLM is given besides the message itself."""

    today: dt.date
    customer_name: Optional[str] = None
    customer_aliases: list[str] = field(default_factory=list)  # "raw -> SKU"
    recent_orders: list[str] = field(default_factory=list)  # compact lines
    catalog: list[dict] = field(default_factory=list)  # sku,name,unit,pack_size
