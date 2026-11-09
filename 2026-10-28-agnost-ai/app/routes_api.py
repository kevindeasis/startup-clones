import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import analysis as an
from . import heuristics as H
from .clustering import recluster
from .db import get_db
from .models import Conversation, ConversationAnalysis, Message, Pattern, PatternMember
from .schemas import CustomPatternIn, IngestRequest

router = APIRouter()


def get_llm(request: Request):
    llm = request.app.state.llm
    if llm is None:
        from .main import setup_app
        setup_app(request.app)
        llm = request.app.state.llm
    return llm


def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"invalid timestamp: {s}")
    if d.tzinfo is not None:
        d = d.astimezone(timezone.utc).replace(tzinfo=None)
    return d


# ---------------------------------------------------------------- serializers
def analysis_dict(a: ConversationAnalysis | None) -> dict | None:
    if not a:
        return None
    return {
        "summary": a.summary, "intent": a.intent, "outcome": a.outcome, "sentiment": a.sentiment,
        "frustration_score": a.frustration_score, "model": a.model, "analyzed_at": a.analyzed_at.isoformat(),
        "signals": json.loads(a.signals_json or "{}"),
        "feature_requests": json.loads(a.feature_requests_json or "[]"),
        "bug_reports": json.loads(a.bug_reports_json or "[]"),
        "has_frustration": a.has_frustration, "has_rephrasing": a.has_rephrasing, "has_correction": a.has_correction,
        "has_feature_request": a.has_feature_request, "has_bug_report": a.has_bug_report,
        "has_hallucination": a.has_hallucination, "has_churn_signal": a.has_churn_signal, "silent_failure": a.silent_failure,
    }


def conversation_dict(c: Conversation, full: bool = False) -> dict:
    a = analysis_dict(c.analysis)
    d = {
        "id": c.id, "user_id": c.user_id, "metadata": json.loads(c.metadata_json or "{}"),
        "first_message_at": c.first_message_at.isoformat() if c.first_message_at else None,
        "last_message_at": c.last_message_at.isoformat() if c.last_message_at else None,
        "message_count": c.message_count, "analyzed": a is not None, "analysis": a,
    }
    if a:  # convenience: flags at top level too
        d.update({k: v for k, v in a.items() if k.startswith("has_") or k == "silent_failure"})
        d["outcome"], d["intent"], d["summary"] = a["outcome"], a["intent"], a["summary"]
    if full:
        d["messages"] = [{"idx": m.idx, "role": m.role, "content": m.content,
                          "timestamp": m.timestamp.isoformat() if m.timestamp else None} for m in c.messages]
    return d


def pattern_dict(db: Session, p: Pattern, members: bool = False) -> dict:
    rows = db.execute(
        select(ConversationAnalysis.intent, PatternMember.group_text)
        .join(PatternMember, PatternMember.conversation_id == ConversationAnalysis.conversation_id)
        .where(PatternMember.pattern_id == p.id)
    ).all()
    if p.kind in ("feature_requests", "bugs"):
        examples = list(dict.fromkeys(r[1] for r in rows if r[1]))[:3]
    else:
        examples = list(dict.fromkeys(r[0] for r in rows))[:3]
    d = {
        "id": p.id, "kind": p.kind, "name": p.name, "description": p.description, "query_text": p.query_text,
        "top_terms": json.loads(p.top_terms_json or "[]"), "conversation_count": p.conversation_count,
        "user_count": p.user_count, "frustrated_pct": p.frustrated_pct, "example_intents": examples,
        "updated_at": p.updated_at.isoformat(),
    }
    if members:
        ms = db.scalars(select(PatternMember).where(PatternMember.pattern_id == p.id).order_by(PatternMember.score.desc(), PatternMember.conversation_id)).all()
        d["members"] = [{"conversation_id": m.conversation_id, "score": m.score, "group_text": m.group_text} for m in ms]
    return d


def grouped_rows(db: Session, kind: str) -> list[dict]:
    p = db.scalar(select(Pattern).where(Pattern.kind == kind))
    if not p:
        return []
    rows = db.execute(
        select(PatternMember.group_text, PatternMember.conversation_id, Conversation.user_id)
        .join(Conversation, Conversation.id == PatternMember.conversation_id)
        .where(PatternMember.pattern_id == p.id).order_by(PatternMember.conversation_id)
    ).all()
    groups: dict[str, dict] = {}
    for gt, cid, uid in rows:
        g = groups.setdefault(gt, {"text": gt, "conversations": [], "users": set()})
        if cid not in g["conversations"]:
            g["conversations"].append(cid)
        if uid:
            g["users"].add(uid)
    out = [{"text": g["text"], "count": len(g["conversations"]), "users": len(g["users"]), "samples": g["conversations"][:5]} for g in groups.values()]
    out.sort(key=lambda g: (-g["count"], g["text"]))
    return out


def query_conversations(db: Session, signal=None, outcome=None, q=None, limit=50, offset=0):
    stmt = select(Conversation).outerjoin(ConversationAnalysis, ConversationAnalysis.conversation_id == Conversation.id)
    if signal:
        col = an.SIGNAL_COLUMNS.get(signal.replace("has_", ""))
        if not col:
            raise HTTPException(422, f"unknown signal '{signal}'; one of {sorted(an.SIGNAL_COLUMNS)}")
        stmt = stmt.where(getattr(ConversationAnalysis, col).is_(True))
    if outcome:
        stmt = stmt.where(ConversationAnalysis.outcome == outcome)
    if q:
        like = f"%{q}%"
        sub = select(Message.conversation_id).where(Message.content.ilike(like))
        stmt = stmt.where(or_(Conversation.id.in_(sub), ConversationAnalysis.summary.ilike(like), ConversationAnalysis.intent.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Conversation.last_message_at.desc(), Conversation.id).limit(limit).offset(offset)).all()
    return total, rows


# ---------------------------------------------------------------- endpoints
@router.get("/healthz")
def healthz(request: Request):
    llm = get_llm(request)
    return {"ok": True, "llm": llm.name}


@router.post("/api/v1/conversations")
def ingest(body: IngestRequest, db: Session = Depends(get_db)):
    by_conv: dict[str, list] = {}
    for m in body.messages:
        by_conv.setdefault(m.conversation_id, []).append(m)
    for cid, msgs in by_conv.items():
        conv = db.get(Conversation, cid)
        if conv is None:
            conv = Conversation(id=cid, message_count=0, metadata_json="{}")
            db.add(conv)
            db.flush()
        meta = json.loads(conv.metadata_json or "{}")
        idx = conv.message_count or 0
        for m in msgs:
            if m.user_id and not conv.user_id:
                conv.user_id = m.user_id
            if m.metadata:
                meta.update(m.metadata)
            ts = parse_ts(m.timestamp)
            db.add(Message(conversation_id=cid, idx=idx, role=m.role, content=m.content, timestamp=ts))
            idx += 1
            if ts:
                conv.first_message_at = min(filter(None, [conv.first_message_at, ts]))
                conv.last_message_at = max(filter(None, [conv.last_message_at, ts]))
        conv.message_count = idx
        conv.metadata_json = json.dumps(meta)
        if conv.analysis is not None:  # transcript changed -> needs re-analysis
            db.delete(conv.analysis)
    db.commit()
    return {"ingested": len(body.messages), "conversations": len(by_conv)}


@router.post("/api/v1/analyze")
async def analyze(request: Request, force: bool = False, db: Session = Depends(get_db)):
    return await an.analyze_pending(db, get_llm(request), force=force)


@router.post("/api/v1/cluster")
async def cluster(request: Request, db: Session = Depends(get_db)):
    return await recluster(db, get_llm(request))


@router.get("/api/v1/stats")
def stats(db: Session = Depends(get_db)):
    return an.compute_stats(db)


@router.get("/api/v1/patterns")
def list_patterns(db: Session = Depends(get_db)):
    ps = db.scalars(select(Pattern).order_by(Pattern.conversation_count.desc(), Pattern.id)).all()
    return {"patterns": [pattern_dict(db, p) for p in ps]}


@router.post("/api/v1/patterns/custom")
async def create_custom(body: CustomPatternIn, request: Request, db: Session = Depends(get_db)):
    p = await an.create_custom_pattern(db, get_llm(request), body.name, body.description)
    return pattern_dict(db, p, members=True)


@router.get("/api/v1/patterns/{pattern_id}")
def get_pattern(pattern_id: int, db: Session = Depends(get_db)):
    p = db.get(Pattern, pattern_id)
    if not p:
        raise HTTPException(404, "pattern not found")
    return pattern_dict(db, p, members=True)


@router.get("/api/v1/conversations")
def list_conversations(signal: str | None = None, outcome: str | None = None, q: str | None = None,
                       limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    total, rows = query_conversations(db, signal, outcome, q, limit, offset)
    return {"total": total, "limit": limit, "offset": offset, "conversations": [conversation_dict(c) for c in rows]}


@router.get("/api/v1/conversations/{conversation_id}")
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    c = db.get(Conversation, conversation_id)
    if not c:
        raise HTTPException(404, "conversation not found")
    d = conversation_dict(c, full=True)
    d["patterns"] = patterns_of(db, conversation_id)
    return d


def patterns_of(db: Session, conversation_id: str) -> list[dict]:
    rows = db.execute(
        select(Pattern.id, Pattern.name, Pattern.kind, PatternMember.group_text)
        .join(PatternMember, PatternMember.pattern_id == Pattern.id)
        .where(PatternMember.conversation_id == conversation_id).order_by(Pattern.id)
    ).all()
    return [{"id": r[0], "name": r[1], "kind": r[2], "group_text": r[3]} for r in rows]


@router.get("/api/v1/export/feature-requests.csv", response_class=PlainTextResponse)
def export_feature_requests(db: Session = Depends(get_db)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["feature_request", "conversations", "distinct_users", "sample_conversation_ids"])
    for g in grouped_rows(db, "feature_requests"):
        w.writerow([g["text"], g["count"], g["users"], " ".join(g["samples"])])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv")
