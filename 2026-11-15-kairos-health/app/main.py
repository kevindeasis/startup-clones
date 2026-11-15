"""FastAPI app: pages + JSON API. Run: uvicorn app.main:app --port 8000"""
import json
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from . import agent, config, db, insurance, recall, stats
from . import scheduling as sch
from .tools import hours_text

BASE = Path(__file__).resolve().parent.parent


@asynccontextmanager
async def lifespan(app):
    conn = db.connect()
    db.init_db(conn)
    if not db.is_seeded(conn):
        db.reset_db(conn)
    conn.close()
    yield


app = FastAPI(title="ChairFill (learning clone)", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")


def get_conn():
    conn = db.connect()
    try:
        db.init_db(conn)
        yield conn
    finally:
        conn.close()


def page(request: Request, name: str, conn, **ctx):
    p = db.one(conn, "SELECT * FROM practice WHERE id=1") or {"name": "Maple Street Dental"}
    ctx.update(mock=config.is_mock(), practice=p, active=name.replace(".html", ""), today=config.today().isoformat())
    return templates.TemplateResponse(request, name, ctx)


class NewConversation(BaseModel):
    channel: str = Field("inbound", pattern="^(inbound|recall)$")


class Text(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class VerifyIn(BaseModel):
    payer: str
    member_id: str
    dob: str
    patient_id: int | None = None


def parse_date(s: str | None) -> date:
    if not s:
        return config.today()
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")


# ---------------- pages ----------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request, conn=Depends(get_conn)):
    return page(request, "index.html", conn, hours=hours_text(json.loads(db.one(conn, "SELECT hours_json FROM practice")["hours_json"])))


@app.get("/schedule", response_class=HTMLResponse)
def schedule_page(request: Request, date: str | None = None, conn=Depends(get_conn)):
    return page(request, "schedule.html", conn, s=sch.day_schedule(conn, parse_date(date)))


@app.get("/recall", response_class=HTMLResponse)
def recall_page(request: Request, conn=Depends(get_conn)):
    return page(request, "recall.html", conn, overdue=recall.overdue_patients(conn), outreach=recall.list_outreach(conn),
                counters=recall.counters(conn), months=config.recall_months())


@app.get("/insurance", response_class=HTMLResponse)
def insurance_page(request: Request, conn=Depends(get_conn)):
    plans = db.rows(conn, """SELECT i.*, p.first_name, p.last_name, p.dob FROM insurance_plans i JOIN patients p ON p.id=i.patient_id ORDER BY i.id""")
    return page(request, "insurance.html", conn, plans=plans, payers=[r["payer"] for r in db.rows(conn, "SELECT DISTINCT payer FROM payer_directory ORDER BY payer")])


@app.get("/calls", response_class=HTMLResponse)
def calls_page(request: Request, conn=Depends(get_conn)):
    return page(request, "calls.html", conn, stats=stats.compute(conn), convs=_list_conversations(conn))


@app.get("/messages", response_class=HTMLResponse)
def messages_page(request: Request, conn=Depends(get_conn)):
    return page(request, "messages.html", conn, msgs=db.rows(conn, "SELECT * FROM messages_taken ORDER BY id DESC"))


# ---------------- API ----------------
@app.get("/health")
def health():
    return {"status": "ok", "mode": config.mode(), "model": config.model() if not config.is_mock() else None}


@app.post("/api/demo/reset")
def demo_reset(conn=Depends(get_conn)):
    return {"ok": True, "seeded": db.reset_db(conn), "mode": config.mode()}


@app.post("/api/conversations")
def new_conversation(body: NewConversation, conn=Depends(get_conn)):
    if body.channel == "recall":
        raise HTTPException(400, "Recall conversations are created by POST /api/recall/run")
    c = agent.create_conversation(conn, body.channel)
    return {"id": c["id"], "greeting": c["greeting"], "mode": config.mode()}


@app.post("/api/conversations/{conv_id}/messages")
def send_message(conv_id: int, body: Text, conn=Depends(get_conn)):
    try:
        return agent.run_turn(conn, conv_id, body.text)
    except KeyError:
        raise HTTPException(404, "conversation not found")


@app.post("/api/conversations/{conv_id}/end")
def end_conversation(conv_id: int, conn=Depends(get_conn)):
    try:
        return agent.end_conversation(conn, conv_id)
    except KeyError:
        raise HTTPException(404, "conversation not found")


def _list_conversations(conn) -> list[dict]:
    out = []
    for r in db.rows(conn, """SELECT c.id, c.channel, c.patient_id, c.started_at, c.ended_at, c.outcome, c.mode, c.messages_json,
                              p.first_name, p.last_name FROM conversations c LEFT JOIN patients p ON p.id=c.patient_id ORDER BY c.id DESC"""):
        msgs = json.loads(r.pop("messages_json"))
        r["turns"] = sum(1 for m in msgs if m["role"] == "user" and isinstance(m["content"], str) and not m["content"].startswith("[system]"))
        r["patient"] = f"{r['first_name']} {r['last_name']}" if r["first_name"] else None
        out.append(r)
    return out


@app.get("/api/conversations")
def list_conversations(conn=Depends(get_conn)):
    return _list_conversations(conn)


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: int, conn=Depends(get_conn)):
    try:
        c = agent.load(conn, conv_id)
    except KeyError:
        raise HTTPException(404, "conversation not found")
    pat = db.one(conn, "SELECT first_name,last_name FROM patients WHERE id=?", (c["patient_id"],)) if c["patient_id"] else None
    return {"id": c["id"], "channel": c["channel"], "patient": f"{pat['first_name']} {pat['last_name']}" if pat else None,
            "started_at": c["started_at"], "ended_at": c["ended_at"], "outcome": c["outcome"], "mode": c["mode"],
            "transcript": agent.transcript(c), "tool_calls": json.loads(c["tool_log_json"])}


@app.get("/api/schedule")
def api_schedule(date: str | None = None, conn=Depends(get_conn)):
    return sch.day_schedule(conn, parse_date(date))


@app.get("/api/availability")
def api_availability(date_from: str | None = None, date_to: str | None = None, type: str = "hygiene", provider_id: int | None = None, conn=Depends(get_conn)):
    if type not in sch.DURATIONS:
        raise HTTPException(400, f"type must be one of {sch.TYPES}")
    d1 = parse_date(date_from)
    d2 = parse_date(date_to) if date_to else d1 + timedelta(days=7)
    if d2 < d1 or (d2 - d1).days > 60:
        raise HTTPException(400, "date range must be 0-60 days")
    slots = sch.open_slots(conn, d1, d2, type, provider_id)
    return {"slots": slots, "count": len(slots)}


@app.get("/api/recall/overdue")
def api_overdue(conn=Depends(get_conn)):
    return {"patients": recall.overdue_patients(conn), "counters": recall.counters(conn), "recall_months": config.recall_months()}


@app.get("/api/recall/outreach")
def api_outreach(conn=Depends(get_conn)):
    return {"outreach": recall.list_outreach(conn), "counters": recall.counters(conn)}


@app.post("/api/recall/run")
def api_recall_run(conn=Depends(get_conn)):
    return recall.run_recall(conn)


@app.post("/api/recall/{outreach_id}/reply")
def api_recall_reply(outreach_id: int, body: Text, conn=Depends(get_conn)):
    try:
        res = recall.reply(conn, outreach_id, body.text)
    except KeyError:
        raise HTTPException(404, "outreach not found")
    res["counters"] = recall.counters(conn)
    return res


@app.post("/api/insurance/verify")
def api_verify(body: VerifyIn, conn=Depends(get_conn)):
    return insurance.verify(conn, body.payer, body.member_id, body.dob, body.patient_id, source="staff")


@app.get("/api/messages")
def api_messages(conn=Depends(get_conn)):
    return db.rows(conn, "SELECT * FROM messages_taken ORDER BY id DESC")


@app.post("/api/messages/{msg_id}/done")
def api_message_done(msg_id: int, done: bool = True, conn=Depends(get_conn)):
    cur = conn.execute("UPDATE messages_taken SET done=? WHERE id=?", (int(done), msg_id))
    conn.commit()
    if not cur.rowcount:
        raise HTTPException(404, "message not found")
    return {"id": msg_id, "done": done}


@app.get("/api/stats")
def api_stats(conn=Depends(get_conn)):
    return stats.compute(conn)
