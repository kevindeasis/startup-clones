"""Docketeer: FastAPI app + routes. Pages are server-rendered Jinja2; JS calls the JSON/form API."""
import html
import json
from contextlib import asynccontextmanager
from pathlib import Path

import markdown as mdlib
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.templating import Jinja2Templates  # noqa: E402

from . import agents, db, llm, pipeline  # noqa: E402
from .agents import OUTSTANDING, AppError  # noqa: E402

HERE = Path(__file__).parent
STAGES = ["intake", "engagement_sent", "onboarding", "active", "closed"]


@asynccontextmanager
async def lifespan(app):
    db.init_db()
    yield


app = FastAPI(title="Docketeer", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(HERE / "static")), name="static")
templates = Jinja2Templates(directory=str(HERE / "templates"))
templates.env.filters["md"] = lambda s: mdlib.markdown(html.escape(s or ""), extensions=["nl2br"])
templates.env.filters["usd"] = lambda x: f"${float(x or 0):,.2f}"
templates.env.filters["fromjson"] = lambda s: json.loads(s) if s else {}
templates.env.filters["date"] = lambda s: (s or "")[:10]


@app.exception_handler(AppError)
async def app_error(request, exc: AppError):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status)


async def body(request: Request) -> dict:
    ct = request.headers.get("content-type", "")
    try:
        if "json" in ct:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        if "form" in ct:
            return {k: v for k, v in (await request.form()).items()}
    except Exception:
        pass
    return {}


def page(request: Request, name: str, **ctx):
    base = {"today": db.today().isoformat(), "mode": "mock" if llm.is_mock() else "live", "model": llm.model_name(), "firm": db.firm(), "stages": STAGES}
    return templates.TemplateResponse(request, name, {**base, **ctx})


def ar_rows() -> list[dict]:
    rows = db.q("SELECT i.*, m.title matter_title, c.name client_name FROM invoices i JOIN matters m ON m.id=i.matter_id JOIN clients c ON c.id=m.client_id WHERE i.status IN ('sent','paid') ORDER BY i.id DESC")
    t = db.today()
    for r in rows:
        r["days_overdue"] = max(0, (t - agents.d10(r["due_date"])).days) if r["status"] == "sent" else 0
    return rows


def approvals_pending() -> list[dict]:
    rows = db.q("""SELECT a.*, m.title matter_title, i.name inquiry_name FROM approvals a
                   LEFT JOIN matters m ON m.id=a.matter_id LEFT JOIN inquiries i ON i.id=a.inquiry_id WHERE a.status='pending' ORDER BY a.type, a.id""")
    for r in rows:
        r["payload"] = json.loads(r["payload_json"] or "{}")
        if r["type"] == "invoice_email":
            inv = db.q1("SELECT * FROM invoices WHERE id=?", (r["payload"]["invoice_id"],))
            r["invoice"] = {**inv, "lines": json.loads(inv["lines_json"])} if inv else None
    return rows


# ----------------------------- pages -----------------------------
@app.get("/health")
def health():
    return {"status": "ok", "mode": "mock" if llm.is_mock() else "live", "model": llm.model_name()}


@app.get("/")
def home(request: Request):
    ar = ar_rows()
    stats = {
        "pending": db.q1("SELECT COUNT(*) c FROM approvals WHERE status='pending'")["c"],
        "new_inquiries": db.q1("SELECT COUNT(*) c FROM inquiries WHERE status='new'")["c"],
        "by_stage": {r["stage"]: r["c"] for r in db.q("SELECT stage, COUNT(*) c FROM matters GROUP BY stage")},
        "docs_outstanding": db.q1(f"SELECT COUNT(*) c FROM matter_documents WHERE status IN ({','.join('?' * len(OUTSTANDING))})", OUTSTANDING)["c"],
        "ar_outstanding": sum(r["subtotal_usd"] for r in ar if r["status"] == "sent"),
        "ar_overdue": sum(r["subtotal_usd"] for r in ar if r["status"] == "sent" and r["days_overdue"] > 0),
    }
    groups: dict[str, list] = {}
    for a in approvals_pending():
        groups.setdefault(a["type"], []).append(a)
    return page(request, "home.html", stats=stats, groups=groups)


@app.get("/inbox")
def inbox(request: Request):
    return page(request, "inbox.html", inquiries=db.q("SELECT * FROM inquiries ORDER BY id"))


@app.get("/inbox/{iid}")
def inquiry_page(request: Request, iid: int):
    inq = db.q1("SELECT * FROM inquiries WHERE id=?", (iid,))
    if not inq:
        raise AppError("inquiry not found", 404)
    pj = json.loads(inq["pipeline_json"]) if inq["pipeline_json"] else None
    return page(request, "inquiry.html", inq=inq, pipeline=pj)


def next_action(m: dict) -> str:
    s = m["stage"]
    if s == "engagement_sent":
        return "Waiting for client to sign engagement letter"
    if s == "onboarding":
        n = db.q1(f"SELECT COUNT(*) c FROM matter_documents WHERE matter_id=? AND status IN ({','.join('?' * len(OUTSTANDING))})", (m["id"], *OUTSTANDING))["c"]
        return f"{n} document(s) outstanding" if n else "Verify documents / approve status update"
    t = db.q1("SELECT title,due_date FROM tasks WHERE matter_id=? AND status='open' ORDER BY due_date LIMIT 1", (m["id"],))
    return f"{t['title']} (due {t['due_date']})" if t else "-"


@app.get("/matters")
def matters(request: Request):
    rows = db.q("SELECT m.*, c.name client_name FROM matters m JOIN clients c ON c.id=m.client_id ORDER BY m.id DESC")
    for m in rows:
        m["next_action"] = next_action(m)
    return page(request, "matters.html", matters=rows)


def snapshot(mid: int) -> dict:
    m = agents.get_matter(mid)
    client = agents.get_client(m)
    docs = db.q("SELECT * FROM matter_documents WHERE matter_id=? ORDER BY id", (mid,))
    for d in docs:
        d["verification"] = json.loads(d["verification_json"]) if d["verification_json"] else None
    invs = db.q("SELECT * FROM invoices WHERE matter_id=? ORDER BY id", (mid,))
    for i in invs:
        i["lines"] = json.loads(i["lines_json"] or "[]")
    letter = db.q1("SELECT * FROM engagement_letters WHERE matter_id=? ORDER BY id DESC", (mid,))
    return {"matter": m, "client": client, "stage": m["stage"], "letter": letter, "documents": docs, "invoices": invs,
            "tasks": db.q("SELECT * FROM tasks WHERE matter_id=? ORDER BY status DESC, due_date", (mid,)),
            "time_entries": db.q("SELECT * FROM time_entries WHERE matter_id=? ORDER BY entry_date,id", (mid,)),
            "events": db.q("SELECT * FROM events WHERE matter_id=? ORDER BY created_at DESC, id DESC", (mid,))}


@app.get("/matters/{mid}")
def matter_page(request: Request, mid: int):
    s = snapshot(mid)
    s["matter"]["portal_url"] = agents.portal_url(s["matter"])
    return page(request, "matter.html", **s, notes=[e for e in s["events"] if e["kind"] == "note"])


@app.get("/outbox")
def outbox(request: Request):
    return page(request, "outbox.html", rows=db.q("SELECT o.*, m.title matter_title FROM outbox o LEFT JOIN matters m ON m.id=o.matter_id ORDER BY o.id DESC"))


@app.get("/activity")
def activity(request: Request):
    return page(request, "activity.html", runs=db.q("SELECT a.*, m.title matter_title FROM agent_runs a LEFT JOIN matters m ON m.id=a.matter_id ORDER BY a.id DESC LIMIT 200"))


@app.get("/billing")
def billing(request: Request):
    rows = ar_rows()
    return page(request, "billing.html", rows=rows,
                outstanding=sum(r["subtotal_usd"] for r in rows if r["status"] == "sent"),
                overdue=sum(r["subtotal_usd"] for r in rows if r["status"] == "sent" and r["days_overdue"] > 0),
                paid=sum(r["subtotal_usd"] for r in rows if r["status"] == "paid"))


@app.get("/portal/{token}")
def portal(request: Request, token: str):
    m = db.q1("SELECT * FROM matters WHERE portal_token=?", (token,))
    if not m:
        raise AppError("portal not found", 404)
    s = snapshot(m["id"])
    updates = db.q("SELECT subject, body, sent_at FROM outbox WHERE matter_id=? AND kind!='chaser_counterparty' ORDER BY id DESC", (m["id"],))
    letter = s["letter"]
    docs = [{**d, "message": (d["verification"] or {}).get("client_message") if d["verification"] else None} for d in s["documents"]]
    return page(request, "portal.html", m=m, client=s["client"], letter=letter, docs=docs, invoices=[i for i in s["invoices"] if i["status"] in ("sent", "paid")],
                client_tasks=[t for t in s["tasks"] if t["owner"] == "client" and t["status"] == "open"], updates=updates, token=token)


# ----------------------------- API -----------------------------
def need(d: dict, *keys):
    for k in keys:
        if d.get(k) in (None, ""):
            raise AppError(f"missing field: {k}")


@app.post("/api/inquiries")
async def add_inquiry(request: Request):
    d = await body(request)
    need(d, "name", "email", "message")
    src = d.get("source") or "web_form"
    if src not in ("email", "web_form", "referral"):
        raise AppError("source must be email|web_form|referral")
    iid = db.insert("inquiries", received_at=db.now(), source=src, name=d["name"], email=d["email"], phone=d.get("phone") or "",
                    subject=d.get("subject") or "(no subject)", message=d["message"], status="new", created_at=db.now())
    return {"id": iid}


@app.post("/api/inquiries/{iid}/run")
def run_inquiry(iid: int):
    return pipeline.run_intake(iid)


@app.get("/api/approvals")
def list_approvals(status: str = "pending"):
    rows = db.q("SELECT * FROM approvals WHERE status=? ORDER BY id", (status,))
    for r in rows:
        r["payload"] = json.loads(r.pop("payload_json") or "{}")
    return rows


@app.post("/api/approvals/{aid}/approve")
async def approve(request: Request, aid: int):
    d = await body(request)
    return agents.approve(aid, d.get("draft_text"), d.get("subject"))


@app.post("/api/approvals/{aid}/reject")
async def reject(request: Request, aid: int):
    d = await body(request)
    return agents.reject(aid, d.get("reason", ""))


@app.post("/api/matters/{mid}/tasks")
async def add_task(request: Request, mid: int):
    d = await body(request)
    agents.get_matter(mid)
    need(d, "title")
    owner = d.get("owner") or "lawyer"
    if owner not in ("lawyer", "client", "agent", "counterparty"):
        raise AppError("owner must be lawyer|client|agent|counterparty")
    tid = db.insert("tasks", matter_id=mid, title=d["title"], owner=owner, due_date=d.get("due_date") or None, status="open", created_at=db.now())
    db.log_event(mid, "task", f"Task added ({owner}): {d['title']}")
    return {"id": tid}


@app.post("/api/tasks/{tid}/done")
def task_done(tid: int):
    t = db.q1("SELECT * FROM tasks WHERE id=?", (tid,))
    if not t:
        raise AppError("task not found", 404)
    db.run("UPDATE tasks SET status='done', done_at=? WHERE id=?", (db.now(), tid))
    db.log_event(t["matter_id"], "task", f"Task done: {t['title']}")
    return {"id": tid, "status": "done"}


@app.post("/api/matters/{mid}/notes")
async def add_note(request: Request, mid: int):
    d = await body(request)
    agents.get_matter(mid)
    need(d, "text")
    db.log_event(mid, "note", d["text"])
    return {"ok": True}


@app.post("/api/matters/{mid}/time")
async def add_time(request: Request, mid: int):
    d = await body(request)
    agents.get_matter(mid)
    need(d, "minutes", "description")
    try:
        minutes = int(d["minutes"])
        rate = float(d.get("rate_usd") or db.get_setting("default_rate_usd"))
    except ValueError:
        raise AppError("minutes and rate must be numbers")
    if minutes <= 0:
        raise AppError("minutes must be positive")
    eid = db.insert("time_entries", matter_id=mid, entry_date=d.get("entry_date") or db.today().isoformat(), minutes=minutes, description=d["description"], rate_usd=rate)
    return {"id": eid}


@app.post("/api/matters/{mid}/invoice")
def make_invoice(mid: int):
    return agents.generate_invoice(mid)


@app.post("/api/documents/{did}/verify")
def lawyer_verify(did: int):
    return agents.lawyer_verify_doc(did)


@app.post("/api/portal/{token}/sign")
async def portal_sign(request: Request, token: str):
    d = await body(request)
    return agents.sign_letter(token, d.get("name", ""), d.get("agree", ""))


@app.post("/api/portal/{token}/upload")
async def portal_upload(request: Request, token: str):
    form = await request.form()
    f = form.get("file")
    if not hasattr(f, "read"):
        raise AppError("missing file")
    try:
        did = int(form.get("document_id"))
    except (TypeError, ValueError):
        raise AppError("missing document_id")
    data = await f.read()
    return agents.process_upload(token, did, f.filename or "", data, form.get("note") or "")


@app.post("/api/portal/{token}/pay/{invoice_id}")
def portal_pay(token: str, invoice_id: int):
    return agents.pay_invoice(token, invoice_id)


@app.post("/agents/run-daily")
def run_daily():
    return agents.run_daily()


@app.post("/api/settings/advance")
def advance(days: int = 1):
    if days < 0 or days > 365:
        raise AppError("days must be between 0 and 365")
    db.set_setting("today", db.add_days(db.today(), days).isoformat())
    return {"today": db.today().isoformat()}


@app.get("/api/matters/{mid}")
def matter_json(mid: int):
    return snapshot(mid)
