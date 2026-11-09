"""Intake pipeline: context -> LLM -> matching -> history -> routing; plus review edits."""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Optional

from rapidfuzz import fuzz
from sqlmodel import Session, select

from . import erp, llm
from .llm_mock import mock_extract
from .matching import match_line, normalize
from .models import (Customer, CustomerAlias, DraftLine, DraftOrder, ErpOrder,
                     ErpOrderLine, ExtractedOrder, InboundMessage, PipelineContext, Product)

HISTORY_CONFIDENCE = 0.85


# ------------------------------------------------------------ customer lookup
def infer_customer(session: Session, message: InboundMessage, hint: Optional[str] = None) -> Optional[Customer]:
    customers = session.exec(select(Customer)).all()
    sender = (message.sender or "").lower()
    digits = re.sub(r"\D", "", sender)
    for c in customers:
        emails = [e.strip().lower() for e in c.contact_emails.split(",") if e.strip()]
        phones = [re.sub(r"\D", "", p) for p in c.contact_phones.split(",") if p.strip()]
        if any(e and e in sender for e in emails) or (digits and any(p and p[-10:] == digits[-10:] for p in phones)):
            return c
    blob = normalize(f"{hint or ''} {message.subject} {message.body_text}")
    words = set(blob.split())
    best, best_score = None, 0.0
    for c in customers:
        n = normalize(c.name)
        score = fuzz.partial_ratio(n, blob) if blob else 0
        first = n.split()[0] if n else ""
        if len(first) >= 5 and first in words:
            score = max(score, 92)
        if score > best_score:
            best, best_score = c, score
    return best if best_score >= 88 else None


def recent_order_lines(session: Session, customer_id: int, n: int = 3) -> list[tuple[ErpOrder, list[ErpOrderLine]]]:
    orders = session.exec(select(ErpOrder).where(ErpOrder.customer_id == customer_id)
                          .order_by(ErpOrder.created_at.desc(), ErpOrder.id.desc())).all()[:n]
    return [(o, session.exec(select(ErpOrderLine).where(ErpOrderLine.erp_order_id == o.id)).all()) for o in orders]


def build_context(session: Session, customer: Optional[Customer], today: dt.date) -> PipelineContext:
    products = session.exec(select(Product).where(Product.active == True)).all()  # noqa: E712
    ctx = PipelineContext(today=today, catalog=[
        {"sku": p.sku, "name": p.name, "unit": p.unit, "pack_size": p.pack_size} for p in products])
    if customer:
        ctx.customer_name = customer.name
        ctx.customer_aliases = [f"'{a.raw_text_normalized}' -> {a.sku}" for a in session.exec(
            select(CustomerAlias).where(CustomerAlias.customer_id == customer.id)).all()]
        for o, lines in recent_order_lines(session, customer.id):
            when = (o.delivery_date or o.created_at.date())
            body = "; ".join(f"{_q(l.qty)} {l.unit} {l.sku}" for l in lines)
            ctx.recent_orders.append(f"{o.erp_number} {when.isoformat()} ({when.strftime('%a')}): {body}")
    return ctx


def _q(q: float) -> str:
    return str(int(q)) if float(q).is_integer() else f"{q:g}"


# ------------------------------------------------------------ history refs
def find_referenced_order(session: Session, customer_id: int, ref: str):
    orders = recent_order_lines(session, customer_id, n=50)
    if not orders:
        return None
    words = normalize(ref).split()
    from .llm_mock import WEEKDAYS
    wd = next((WEEKDAYS[w] for w in words if w in WEEKDAYS), None)
    if wd is not None:
        for o, lines in orders:
            if (o.delivery_date or o.created_at.date()).weekday() == wd:
                return o, lines
    return orders[0]


def apply_history(session: Session, customer: Customer, extracted: ExtractedOrder,
                  products: list[Product]) -> list[DraftLine]:
    """Return history-sourced DraftLines (unsaved) replacing qty-less placeholder lines."""
    found = find_referenced_order(session, customer.id, extracted.repeat_reference or "")
    if not found:
        return []
    order, olines = found
    by_sku = {p.sku: p for p in products}
    out: list[DraftLine] = []
    placeholders = [l for l in extracted.lines if l.qty is None]
    wanted = [normalize(l.product_text) for l in placeholders if normalize(l.product_text)]
    for ol in olines:
        prod = by_sku.get(ol.sku)
        desc = normalize(f"{ol.description} {' '.join(prod.alias_list()) if prod else ''}")
        if wanted and not any(fuzz.partial_ratio(w, desc) >= 75 for w in wanted):
            continue
        out.append(DraftLine(
            draft_id=0, raw_text=(placeholders[0].raw_text if len(placeholders) == 1 else extracted.repeat_reference) or "", qty=ol.qty, unit=ol.unit,
            product_text=ol.description, sku=ol.sku, product_id=prod.id if prod else None,
            confidence=HISTORY_CONFIDENCE,
            candidates=json.dumps([{"sku": ol.sku, "name": ol.description, "score": HISTORY_CONFIDENCE}]),
            source="history", flag=f"Copied from {order.erp_number} - confirm", note=order.erp_number))
    return out


# ------------------------------------------------------------ main pipeline
def process_message(session: Session, message: InboundMessage, customer_id: Optional[int] = None,
                    today: Optional[dt.date] = None) -> DraftOrder:
    today = today or dt.date.today()
    customer = session.get(Customer, customer_id) if customer_id else None
    if customer is None:
        customer = infer_customer(session, message)
    ctx = build_context(session, customer, today)
    provider, model = llm.provider_name(), llm.model_name()
    try:
        extracted = llm.extract_order(message, ctx)
    except Exception as exc:  # network/API failure: degrade to mock, force review
        extracted = mock_extract(message.body_text or "", ctx, has_image=llm._has_image(message))
        extracted.questions.append(f"LLM call failed ({type(exc).__name__}); used mock extraction.")
        provider, model = "mock", "mock-v1"
    if customer is None:
        customer = infer_customer(session, message, extracted.customer_name_hint)
        if customer:
            ctx = build_context(session, customer, today)

    products = session.exec(select(Product).where(Product.active == True)).all()  # noqa: E712
    aliases = {}
    if customer:
        aliases = {a.raw_text_normalized: a.sku for a in session.exec(
            select(CustomerAlias).where(CustomerAlias.customer_id == customer.id)).all()}

    delivery = None
    if extracted.delivery_date:
        try:
            delivery = dt.date.fromisoformat(extracted.delivery_date[:10])
        except ValueError:
            pass

    draft = DraftOrder(message_id=message.id, customer_id=customer.id if customer else None,
                       inferred_customer_name=(extracted.customer_name_hint or None),
                       delivery_date=delivery, llm_notes=f"language={extracted.language}",
                       llm_questions=json.dumps(extracted.questions), llm_provider=provider, llm_model=model)
    session.add(draft)
    session.flush()

    history_lines: list[DraftLine] = []
    if extracted.repeat_reference and customer:
        history_lines = apply_history(session, customer, extracted, products)
    resolved_by_history = bool(history_lines)
    new_lines: list[DraftLine] = []
    for el in extracted.lines:
        if el.qty is None and extracted.repeat_reference:
            if resolved_by_history:
                continue  # placeholder replaced by history copy
        sku, conf, cands = match_line(el.product_text, aliases, products, unit=el.unit)
        new_lines.append(DraftLine(
            draft_id=draft.id, raw_text=el.raw_text, qty=el.qty, unit=el.unit, product_text=el.product_text,
            sku=sku, confidence=conf, candidates=json.dumps(cands), note=el.note))
    if extracted.repeat_reference and not resolved_by_history:
        extracted.questions.append(
            f"Could not resolve '{extracted.repeat_reference}' to a past order"
            + ("" if customer else " (customer unknown)") + ".")
        draft.llm_questions = json.dumps(extracted.questions)
        new_lines = [l for l in new_lines]  # keep placeholders so a human can fill them in
    for hl in history_lines:
        hl.draft_id = draft.id
    for l in new_lines + history_lines:
        _flag_line(l, session, products)
        session.add(l)
    session.flush()
    draft.status = route(draft, new_lines + history_lines)
    session.add(draft)
    session.commit()
    return draft


def _flag_line(line: DraftLine, session: Session, products: list[Product]) -> None:
    if line.sku:
        line.product_id = next((p.id for p in products if p.sku == line.sku), None)
    if line.source == "history":
        return
    th = erp.threshold()
    if not line.sku:
        line.flag = "No catalog match"
    elif line.qty is None:
        line.flag = "Quantity missing"
    elif line.confidence < th:
        line.flag = f"Low confidence ({round(line.confidence * 100)}%)"


def route(draft: DraftOrder, lines: list[DraftLine]) -> str:
    th = erp.threshold()
    ok = (draft.customer_id is not None and lines and not draft.questions()
          and all(l.sku and l.qty and l.confidence >= th for l in lines))
    return "auto_approved" if ok else "needs_review"


# ------------------------------------------------------------ review actions
class ReviewError(ValueError):
    pass


def update_line(session: Session, draft: DraftOrder, line: DraftLine, sku: Optional[str],
                qty: Optional[float], unit: Optional[str]) -> DraftLine:
    if draft.status in ("pushed", "rejected"):
        raise ReviewError(f"Order is already {draft.status}")
    if sku and sku != line.sku:
        prod = session.exec(select(Product).where(Product.sku == sku)).first()
        if prod is None:
            raise ReviewError(f"Unknown SKU {sku}")
        line.sku, line.product_id = prod.sku, prod.id
        line.confidence, line.flag, line.note = 1.0, None, "Confirmed by reviewer"
        if line.source == "history":
            line.source = "message"
        key = normalize(line.product_text)
        if draft.customer_id and key:
            existing = session.exec(select(CustomerAlias).where(
                CustomerAlias.customer_id == draft.customer_id,
                CustomerAlias.raw_text_normalized == key)).first()
            if existing:
                existing.sku = prod.sku
                session.add(existing)
            else:
                session.add(CustomerAlias(customer_id=draft.customer_id, raw_text_normalized=key, sku=prod.sku))
    if qty is not None:
        line.qty = qty
        if qty > 0 and line.flag and line.flag.startswith("Quantity"):
            line.flag = None
    if unit is not None:
        line.unit = unit or None
    session.add(line)
    session.commit()
    return line


def assign_customer(session: Session, draft: DraftOrder, customer_id: int) -> None:
    """Set the customer on a draft that had none, re-match message lines and re-route."""
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise ReviewError("Unknown customer")
    draft.customer_id = customer.id
    aliases = {a.raw_text_normalized: a.sku for a in session.exec(
        select(CustomerAlias).where(CustomerAlias.customer_id == customer.id)).all()}
    products = session.exec(select(Product).where(Product.active == True)).all()  # noqa: E712
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft.id)).all()
    for l in lines:
        if l.source == "message" and l.note != "Confirmed by reviewer":
            sku, conf, cands = match_line(l.product_text, aliases, products, unit=l.unit)
            l.sku, l.confidence, l.candidates, l.flag = sku, conf, json.dumps(cands), None
            _flag_line(l, session, products)
            session.add(l)
    if draft.status in ("needs_review", "auto_approved"):
        draft.status = route(draft, lines)
    session.add(draft)
    session.commit()


def approve(session: Session, draft: DraftOrder):
    if draft.status in ("pushed", "rejected"):
        raise ReviewError(f"Order is already {draft.status}")
    if draft.customer_id is None:
        raise ReviewError("Pick a customer before pushing to the ERP")
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft.id)).all()
    usable = [l for l in lines if l.sku and l.qty and l.qty > 0]
    bad = [l for l in lines if l.qty != 0 and (not l.sku or l.qty is None)]
    if bad:
        raise ReviewError("Resolve all lines first (choose a SKU and quantity for: "
                          + ", ".join((l.product_text or l.raw_text) for l in bad)
                          + "; set qty 0 to drop a line)")
    if not usable:
        raise ReviewError("No usable lines to push")
    return erp.push_to_erp(session, draft)


def reject(session: Session, draft: DraftOrder) -> None:
    if draft.status == "pushed":
        raise ReviewError("Order is already pushed")
    draft.status = "rejected"
    session.add(draft)
    session.commit()
