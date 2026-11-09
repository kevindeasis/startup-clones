"""FastAPI app: routes for intake, review queue, ERP push, learning loop."""
from __future__ import annotations

import datetime as dt
import email
import email.policy
import io
import json
import re
import uuid
from contextlib import asynccontextmanager
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlmodel import Session, select

from . import erp, llm, pipeline
from .db import SAMPLES_DIR, get_session, init_db, upload_dir
from .models import (Customer, CustomerAlias, DraftLine, DraftOrder, ErpOrder, InboundMessage,
                     Product, RepSummary)

APP_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))
templates.env.filters["pct"] = lambda v: f"{round((v or 0) * 100)}%"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="OrderDesk", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")
app.mount("/uploads", StaticFiles(directory=str(upload_dir())), name="uploads")

SAMPLE_META = {
    "sms_bluefin.txt": {"channel": "sms", "customer": "Blue Fin Bistro", "sender": "+1-555-0101", "label": "SMS - Blue Fin Bistro (shorthand + 'same as last Friday')"},
    "email_elpuerto.eml": {"channel": "email", "customer": "", "sender": "", "label": "Email (.eml) - Mariscos El Puerto (Spanish table)"},
    "email_table.txt": {"channel": "email", "customer": "", "sender": "", "label": "Email - table with typos (Blue Fin Bistro)"},
    "pdf_order_sheet.pdf": {"channel": "pdf", "customer": "Sakura Omakase", "sender": "", "label": "PDF order sheet - Sakura Omakase"},
    "photo_note.png": {"channel": "photo", "customer": "", "sender": "", "label": "Photo of handwritten note (needs Anthropic key for real OCR)"},
}


# ---------------------------------------------------------------- file ingestion
class _Strip(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out: list[str] = []

    def handle_data(self, d):
        self.out.append(d)


def parse_eml(raw: bytes) -> tuple[str, str, str]:
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    body = msg.get_body(preferencelist=("plain",))
    if body is not None:
        text = body.get_content()
    else:
        html = msg.get_body(preferencelist=("html",))
        p = _Strip()
        p.feed(html.get_content() if html else "")
        text = "\n".join(x.strip() for x in p.out if x.strip())
    return str(msg.get("From", "")), str(msg.get("Subject", "")), text


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((pg.extract_text() or "") for pg in reader.pages).strip()


def prepare_image(data: bytes, dest: Path) -> None:
    from PIL import Image

    with Image.open(io.BytesIO(data)) as im:
        im.load()
        im = im.convert("RGB")
        im.thumbnail((1568, 1568))
        im.save(dest, format="PNG")


def _headers_from_text(text: str) -> tuple[str, str]:
    f = re.search(r"^from:\s*(.+)$", text, re.I | re.M)
    s = re.search(r"^subject:\s*(.+)$", text, re.I | re.M)
    return (f.group(1).strip() if f else ""), (s.group(1).strip() if s else "")


# ---------------------------------------------------------------- routes
@app.get("/health")
def health():
    return {"ok": True, "llm_provider": llm.provider_name()}


@app.get("/", response_class=HTMLResponse)
def queue(request: Request, status: Optional[str] = None, session: Session = Depends(get_session)):
    q = select(DraftOrder).order_by(DraftOrder.created_at.desc(), DraftOrder.id.desc())
    if status:
        q = q.where(DraftOrder.status == status)
    rows = []
    for d in session.exec(q).all():
        msg = session.get(InboundMessage, d.message_id)
        cust = session.get(Customer, d.customer_id) if d.customer_id else None
        lines = session.exec(select(DraftLine).where(DraftLine.draft_id == d.id)).all()
        rows.append({"d": d, "msg": msg, "cust": cust, "n": len(lines),
                     "flagged": sum(1 for l in lines if l.flag)})
    return templates.TemplateResponse(request, "queue.html", {"rows": rows, "status": status})


@app.get("/intake", response_class=HTMLResponse)
def intake_form(request: Request, sample: Optional[str] = None, session: Session = Depends(get_session)):
    customers = session.exec(select(Customer).order_by(Customer.name)).all()
    form = {"body": "", "channel": "email", "customer_id": "", "sender": "", "subject": "", "sample_file": ""}
    if sample and sample in SAMPLE_META and (SAMPLES_DIR / sample).exists():
        meta = SAMPLE_META[sample]
        form.update(channel=meta["channel"], sender=meta["sender"])
        cust = next((c for c in customers if c.name == meta["customer"]), None)
        form["customer_id"] = str(cust.id) if cust else ""
        if sample.endswith(".txt"):
            form["body"] = (SAMPLES_DIR / sample).read_text()
        else:
            form["sample_file"] = sample
    return templates.TemplateResponse(request, "intake.html", {
        "customers": customers, "form": form, "samples": SAMPLE_META,
        "selected_sample": sample or "", "provider": llm.provider_name()})


@app.post("/intake")
async def intake_submit(
    body_text: str = Form(""), channel: str = Form("email"), customer_id: str = Form(""),
    sender: str = Form(""), subject: str = Form(""), sample_file: str = Form(""),
    file: Optional[UploadFile] = File(None), session: Session = Depends(get_session),
):
    data, filename = b"", ""
    if file is not None and file.filename:
        data, filename = await file.read(), file.filename
    elif sample_file and sample_file in SAMPLE_META and (SAMPLES_DIR / sample_file).exists():
        data, filename = (SAMPLES_DIR / sample_file).read_bytes(), sample_file

    body, att_path, att_kind = body_text, None, None
    ext = Path(filename).suffix.lower()
    if data:
        if ext == ".eml":
            f, s, text = parse_eml(data)
            sender, subject = sender or f, subject or s
            body = (body + "\n" + text).strip() if body.strip() else text
            att_kind = "eml"
        elif ext == ".pdf":
            try:
                text = pdf_text(data)
            except Exception as exc:
                raise HTTPException(400, f"Could not read PDF: {exc}")
            body = (body + "\n" + text).strip() if body.strip() else text
            att_kind, channel = "pdf", "pdf"
            dest = upload_dir() / f"{uuid.uuid4().hex}.pdf"
            dest.write_bytes(data)
            att_path = str(dest)
        elif ext in (".png", ".jpg", ".jpeg"):
            dest = upload_dir() / f"{uuid.uuid4().hex}.png"
            try:
                prepare_image(data, dest)
            except Exception as exc:
                raise HTTPException(400, f"Could not read image: {exc}")
            att_kind, att_path, channel = "image", str(dest), "photo"
        else:
            raise HTTPException(400, "Unsupported file type (use .png/.jpg/.pdf/.eml)")
    if not sender or not subject:
        f, s = _headers_from_text(body)
        sender, subject = sender or f, subject or s
    if not body.strip() and not att_path:
        raise HTTPException(400, "Paste a message or attach a file")
    if channel not in ("email", "sms", "photo", "pdf"):
        channel = "email"

    msg = InboundMessage(channel=channel, sender=sender, subject=subject, body_text=body,
                         attachment_path=att_path, attachment_kind=att_kind)
    session.add(msg)
    session.commit()
    draft = pipeline.process_message(session, msg, int(customer_id) if customer_id else None)
    return RedirectResponse(f"/orders/{draft.id}", status_code=303)


def _order_ctx(session: Session, draft: DraftOrder, error: Optional[str] = None) -> dict:
    msg = session.get(InboundMessage, draft.message_id)
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft.id).order_by(DraftLine.id)).all()
    summary = session.exec(select(RepSummary).where(RepSummary.draft_id == draft.id)).first()
    erp_order = session.exec(select(ErpOrder).where(ErpOrder.draft_id == draft.id)).first()
    return {
        "d": draft, "msg": msg, "lines": lines, "summary": summary, "erp_order": erp_order,
        "cust": session.get(Customer, draft.customer_id) if draft.customer_id else None,
        "customers": session.exec(select(Customer).order_by(Customer.name)).all(),
        "products": session.exec(select(Product).where(Product.active == True).order_by(Product.name)).all(),  # noqa: E712
        "threshold": erp.threshold(), "error": error,
        "att_name": Path(msg.attachment_path).name if msg and msg.attachment_path else None,
    }


def _get_draft(session: Session, draft_id: int) -> DraftOrder:
    d = session.get(DraftOrder, draft_id)
    if d is None:
        raise HTTPException(404, "Order not found")
    return d


@app.get("/orders/{draft_id}", response_class=HTMLResponse)
def order_detail(request: Request, draft_id: int, session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    return templates.TemplateResponse(request, "order.html", _order_ctx(session, d))


@app.post("/orders/{draft_id}/lines/{line_id}", response_class=HTMLResponse)
def update_line(request: Request, draft_id: int, line_id: int, sku: str = Form(""),
                qty: str = Form(""), unit: str = Form(""), session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    line = session.get(DraftLine, line_id)
    if line is None or line.draft_id != d.id:
        raise HTTPException(404, "Line not found")
    try:
        q = float(qty) if qty.strip() else None
    except ValueError:
        raise HTTPException(400, "qty must be a number")
    try:
        pipeline.update_line(session, d, line, sku or None, q, unit.strip())
    except pipeline.ReviewError as e:
        raise HTTPException(400, str(e))
    if request.headers.get("HX-Request"):
        ctx = _order_ctx(session, d)
        return templates.TemplateResponse(request, "_line_row.html", {**ctx, "l": line})
    return RedirectResponse(f"/orders/{d.id}", status_code=303)


@app.post("/orders/{draft_id}/customer")
def set_customer(draft_id: int, customer_id: int = Form(...), session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    try:
        pipeline.assign_customer(session, d, customer_id)
    except pipeline.ReviewError as e:
        raise HTTPException(400, str(e))
    return RedirectResponse(f"/orders/{d.id}", status_code=303)


@app.post("/orders/{draft_id}/approve")
def approve(request: Request, draft_id: int, session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    try:
        pipeline.approve(session, d)
    except pipeline.ReviewError as e:
        return templates.TemplateResponse(request, "order.html", _order_ctx(session, d, str(e)), status_code=400)
    return RedirectResponse(f"/orders/{d.id}", status_code=303)


@app.post("/orders/{draft_id}/reject")
def reject(request: Request, draft_id: int, session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    try:
        pipeline.reject(session, d)
    except pipeline.ReviewError as e:
        return templates.TemplateResponse(request, "order.html", _order_ctx(session, d, str(e)), status_code=400)
    return RedirectResponse(f"/orders/{d.id}", status_code=303)


@app.get("/customers", response_class=HTMLResponse)
def customers(request: Request, session: Session = Depends(get_session)):
    rows = []
    for c in session.exec(select(Customer).order_by(Customer.name)).all():
        n_alias = len(session.exec(select(CustomerAlias).where(CustomerAlias.customer_id == c.id)).all())
        n_orders = len(session.exec(select(ErpOrder).where(ErpOrder.customer_id == c.id)).all())
        rows.append({"c": c, "n_alias": n_alias, "n_orders": n_orders})
    return templates.TemplateResponse(request, "customers.html", {"rows": rows})


@app.get("/customers/{cid}", response_class=HTMLResponse)
def customer_detail(request: Request, cid: int, session: Session = Depends(get_session)):
    c = session.get(Customer, cid)
    if c is None:
        raise HTTPException(404, "Customer not found")
    aliases = session.exec(select(CustomerAlias).where(CustomerAlias.customer_id == cid)
                           .order_by(CustomerAlias.id)).all()
    names = {p.sku: p.name for p in session.exec(select(Product)).all()}
    orders = [{"o": o, "lines": ls} for o, ls in pipeline.recent_order_lines(session, cid, n=50)]
    return templates.TemplateResponse(request, "customer.html", {
        "c": c, "aliases": aliases, "names": names, "orders": orders})


@app.post("/customers/{cid}/aliases/{alias_id}/delete")
def delete_alias(cid: int, alias_id: int, session: Session = Depends(get_session)):
    a = session.get(CustomerAlias, alias_id)
    if a is None or a.customer_id != cid:
        raise HTTPException(404, "Alias not found")
    session.delete(a)
    session.commit()
    return RedirectResponse(f"/customers/{cid}", status_code=303)


@app.get("/catalog", response_class=HTMLResponse)
def catalog(request: Request, session: Session = Depends(get_session)):
    products = session.exec(select(Product).order_by(Product.category, Product.name)).all()
    return templates.TemplateResponse(request, "catalog.html", {"products": products})


@app.get("/summaries", response_class=HTMLResponse)
def summaries(request: Request, session: Session = Depends(get_session)):
    rows = session.exec(select(RepSummary).order_by(RepSummary.created_at.desc(), RepSummary.id.desc())).all()
    return templates.TemplateResponse(request, "summaries.html", {"rows": rows})


@app.get("/erp/orders")
def erp_orders(session: Session = Depends(get_session)):
    return JSONResponse(erp.export_orders(session))


@app.get("/erp/orders.csv")
def erp_orders_csv(session: Session = Depends(get_session)):
    return Response(erp.export_csv(session), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="orders.csv"'})


@app.get("/api/orders/{draft_id}")
def api_order(draft_id: int, session: Session = Depends(get_session)):
    d = _get_draft(session, draft_id)
    msg = session.get(InboundMessage, d.message_id)
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == d.id).order_by(DraftLine.id)).all()
    summary = session.exec(select(RepSummary).where(RepSummary.draft_id == d.id)).first()
    return {
        "id": d.id, "status": d.status, "customer_id": d.customer_id,
        "inferred_customer_name": d.inferred_customer_name,
        "delivery_date": d.delivery_date.isoformat() if d.delivery_date else None,
        "questions": d.questions(), "llm_provider": d.llm_provider, "llm_model": d.llm_model,
        "message": {"id": msg.id, "channel": msg.channel, "sender": msg.sender, "subject": msg.subject,
                    "body_text": msg.body_text},
        "lines": [{"id": l.id, "raw_text": l.raw_text, "qty": l.qty, "unit": l.unit,
                   "product_text": l.product_text, "sku": l.sku, "confidence": l.confidence,
                   "candidates": l.candidate_list(), "source": l.source, "flag": l.flag} for l in lines],
        "summary": summary.text if summary else None,
    }
