import json
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import analysis as an
from . import heuristics as H
from .db import get_db
from .models import Conversation, Pattern, PatternMember
from .routes_api import conversation_dict, get_llm, grouped_rows, pattern_dict, patterns_of, query_conversations

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

KIND_LABEL = {"cluster": "Discovered cluster", "feature_requests": "Default: feature requests", "bugs": "Default: bugs", "custom": "Custom"}
templates.env.globals["KIND_LABEL"] = KIND_LABEL


@router.get("/")
def overview(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "overview.html", {"stats": an.compute_stats(db), "active": "overview"})


@router.get("/patterns")
def patterns(request: Request, db: Session = Depends(get_db)):
    ps = db.scalars(select(Pattern).order_by(Pattern.conversation_count.desc(), Pattern.id)).all()
    return templates.TemplateResponse(request, "patterns.html", {"patterns": [pattern_dict(db, p) for p in ps], "active": "patterns"})


@router.get("/patterns/custom")
def custom_form(request: Request):
    return templates.TemplateResponse(request, "custom_pattern.html", {"active": "patterns"})


@router.post("/patterns/custom")
async def custom_create(request: Request, name: str = Form(...), description: str = Form(...), db: Session = Depends(get_db)):
    p = await an.create_custom_pattern(db, get_llm(request), name, description)
    return RedirectResponse(f"/patterns/{p.id}", status_code=303)


@router.get("/patterns/{pattern_id}")
def pattern_detail(pattern_id: int, request: Request, db: Session = Depends(get_db)):
    p = db.get(Pattern, pattern_id)
    if not p:
        raise HTTPException(404, "pattern not found")
    d = pattern_dict(db, p, members=True)
    seen, convs = set(), []
    for m in d["members"]:
        if m["conversation_id"] in seen:
            continue
        seen.add(m["conversation_id"])
        c = db.get(Conversation, m["conversation_id"])
        cd = conversation_dict(c)
        cd["group_text"] = m["group_text"]
        cd["score"] = m["score"]
        convs.append(cd)
    return templates.TemplateResponse(request, "pattern_detail.html", {"p": d, "convs": convs, "active": "patterns"})


@router.get("/feature-requests")
def feature_requests(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "grouped.html", {
        "title": "Feature requests", "blurb": "Features users asked for that the assistant could not do, grouped by near-duplicate phrasing.",
        "groups": grouped_rows(db, "feature_requests"), "active": "feature-requests", "csv": True})


@router.get("/bugs")
def bugs(request: Request, db: Session = Depends(get_db)):
    return templates.TemplateResponse(request, "grouped.html", {
        "title": "Bugs", "blurb": "Things users report as broken, grouped by near-duplicate phrasing.",
        "groups": grouped_rows(db, "bugs"), "active": "bugs", "csv": False})


@router.get("/conversations")
def conversations(request: Request, signal: str = "", outcome: str = "", q: str = "",
                  limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    total, rows = query_conversations(db, signal or None, outcome or None, q or None, limit, offset)
    return templates.TemplateResponse(request, "conversations.html", {
        "convs": [conversation_dict(c) for c in rows], "total": total, "signal": signal, "outcome": outcome, "q": q,
        "signals": sorted({"frustration", "rephrasing", "correction", "feature_request", "bug_report", "hallucination", "churn_signal", "silent_failure"}),
        "outcomes": ["resolved", "partial", "unresolved", "abandoned"], "active": "conversations"})


@router.get("/conversations/{conversation_id}")
def conversation_detail(conversation_id: str, request: Request, db: Session = Depends(get_db)):
    c = db.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "conversation not found")
    d = conversation_dict(c, full=True)
    flags = H.message_flags(d["messages"])
    for m in d["messages"]:
        m["flags"] = flags.get(m["idx"], [])
    return templates.TemplateResponse(request, "conversation_detail.html", {
        "c": d, "analysis_json": json.dumps(d["analysis"], indent=2) if d["analysis"] else None,
        "patterns": patterns_of(db, conversation_id), "active": "conversations"})
