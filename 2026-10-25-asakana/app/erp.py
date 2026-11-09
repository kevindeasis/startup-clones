"""Mock ERP: push an approved draft, build the rep summary, export."""
from __future__ import annotations

import csv
import datetime as dt
import io
import os

from sqlmodel import Session, select

from .models import (Customer, DraftLine, DraftOrder, ErpOrder, ErpOrderLine,
                     Product, RepSummary, utcnow)


def threshold() -> float:
    return float(os.environ.get("AUTO_APPROVE_THRESHOLD", "0.90"))


def next_erp_number(session: Session) -> str:
    nums = []
    for o in session.exec(select(ErpOrder)).all():
        try:
            nums.append(int(o.erp_number.split("-")[-1]))
        except ValueError:
            pass
    return f"SO-{max(nums + [1000]) + 1}"


def _fmt_qty(q: float) -> str:
    return str(int(q)) if float(q).is_integer() else f"{q:g}"


def build_summary(erp: ErpOrder, customer: Customer, items: list[tuple[DraftLine, Product]]) -> str:
    parts = []
    watch = []
    for line, prod in items:
        parts.append(f"{_fmt_qty(line.qty)} {line.unit or prod.unit} {prod.name}")
        if line.source == "history":
            watch.append(f"'{line.product_text}' copied from past order{(' ' + line.note) if line.note else ''}")
        elif line.confidence < threshold():
            watch.append(f"'{line.product_text}' matched to {prod.name} at {round(line.confidence * 100)}%")
    text = f"Entered order #{erp.erp_number.split('-')[-1]} for {customer.name}: {', '.join(parts)}."
    if erp.delivery_date:
        text += f" Delivery {erp.delivery_date.isoformat()}."
    if watch:
        text += " Watch: " + "; ".join(watch) + "."
    return text


def push_to_erp(session: Session, draft: DraftOrder) -> tuple[ErpOrder, RepSummary]:
    """Write ErpOrder/lines, mark pushed, create the RepSummary. Caller validates."""
    customer = session.get(Customer, draft.customer_id)
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft.id)).all()
    erp = ErpOrder(erp_number=next_erp_number(session), customer_id=customer.id,
                   delivery_date=draft.delivery_date, draft_id=draft.id)
    session.add(erp)
    session.flush()
    items = []
    for l in lines:
        if not l.sku or not l.qty or l.qty <= 0:
            continue
        prod = session.exec(select(Product).where(Product.sku == l.sku)).one()
        session.add(ErpOrderLine(erp_order_id=erp.id, sku=prod.sku, qty=l.qty,
                                 unit=l.unit or prod.unit, description=prod.name))
        items.append((l, prod))
    summary = RepSummary(draft_id=draft.id, text=build_summary(erp, customer, items))
    session.add(summary)
    draft.status = "pushed"
    draft.pushed_at = utcnow()
    session.add(draft)
    session.commit()
    return erp, summary


def export_orders(session: Session) -> list[dict]:
    out = []
    for o in session.exec(select(ErpOrder).order_by(ErpOrder.id)).all():
        cust = session.get(Customer, o.customer_id)
        lines = session.exec(select(ErpOrderLine).where(ErpOrderLine.erp_order_id == o.id)).all()
        out.append({
            "erp_number": o.erp_number, "customer": cust.name if cust else None,
            "customer_id": o.customer_id,
            "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
            "created_at": o.created_at.isoformat(), "draft_id": o.draft_id,
            "lines": [{"sku": l.sku, "description": l.description, "qty": l.qty, "unit": l.unit}
                      for l in lines],
        })
    return out


def export_csv(session: Session) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["erp_number", "customer", "delivery_date", "created_at", "sku", "description", "qty", "unit"])
    for o in export_orders(session):
        for l in o["lines"]:
            w.writerow([o["erp_number"], o["customer"], o["delivery_date"] or "", o["created_at"],
                        l["sku"], l["description"], l["qty"], l["unit"]])
    return buf.getvalue()
