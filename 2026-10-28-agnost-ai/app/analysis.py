"""Per-conversation analysis pipeline + overview statistics + custom-pattern application."""
import asyncio
import json
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import heuristics as H
from .config import get_settings
from .llm import LLM
from .models import Conversation, ConversationAnalysis, Pattern, PatternMember, utcnow

CONCURRENCY = 4
SIGNAL_COLUMNS = {
    "frustration": "has_frustration",
    "rephrasing": "has_rephrasing",
    "correction": "has_correction",
    "feature_request": "has_feature_request",
    "bug_report": "has_bug_report",
    "bug": "has_bug_report",
    "hallucination": "has_hallucination",
    "churn_signal": "has_churn_signal",
    "churn": "has_churn_signal",
    "silent_failure": "silent_failure",
}


def turns_of(conv: Conversation) -> list[dict]:
    return [{"role": m.role, "content": m.content} for m in conv.messages]


def _load_pending(db: Session, force: bool):
    q = select(Conversation).order_by(Conversation.created_at, Conversation.id)
    convs = db.scalars(q).all()
    pending, skipped = [], 0
    for c in convs:
        has_user = any(m.role == "user" for m in c.messages)
        if not has_user or (c.analysis is not None and not force):
            skipped += 1
            continue
        pending.append(c)
    return pending, skipped


def store_analysis(db: Session, conv_id: str, result, model: str, hints: dict):
    sig = result.signals
    sig_json = {**result.signals.model_dump(), "hints": hints, "evidence": result.evidence}
    existing = db.get(ConversationAnalysis, conv_id)
    if existing:
        db.delete(existing)
        db.flush()
    db.add(ConversationAnalysis(
        conversation_id=conv_id,
        summary=result.summary, intent=result.intent, outcome=result.outcome, sentiment=result.sentiment,
        frustration_score=result.frustration_score,
        signals_json=json.dumps(sig_json),
        feature_requests_json=json.dumps(result.feature_requests),
        bug_reports_json=json.dumps(result.bug_reports),
        model=model, analyzed_at=utcnow(),
        has_frustration=sig.frustration or result.frustration_score >= 0.7,
        has_rephrasing=sig.repeated_rephrasing or hints.get("rephrase_count", 0) >= 1,
        has_correction=sig.correction,
        has_feature_request=bool(result.feature_requests),
        has_bug_report=bool(result.bug_reports),
        has_hallucination=sig.hallucination_suspected,
        has_churn_signal=sig.churn_signal,
        silent_failure=sig.silent_failure,
    ))


async def analyze_pending(db: Session, llm: LLM, force: bool = False) -> dict:
    pending, skipped = _load_pending(db, force)
    payload = [(c.id, turns_of(c)) for c in pending]
    sem = asyncio.Semaphore(CONCURRENCY)
    product = get_settings()["product_name"]

    async def one(cid, turns):
        hints = H.compute_hints(turns)
        async with sem:
            result, model = await llm.analyze_conversation(product, hints, turns)
        return cid, result, model, hints

    results = await asyncio.gather(*(one(cid, t) for cid, t in payload))
    for cid, result, model, hints in results:
        store_analysis(db, cid, result, model, hints)
    db.commit()
    # re-apply custom patterns to the newly analyzed conversations
    new_ids = [cid for cid, *_ in results]
    if new_ids:
        for p in db.scalars(select(Pattern).where(Pattern.kind == "custom")).all():
            await apply_custom_pattern(db, llm, p, new_ids)
    return {"analyzed": len(results), "skipped": skipped, "model": llm.model if llm.name != "mock" else "mock"}


# ---------------------------------------------------------------- patterns
def refresh_pattern_stats(db: Session, pattern: Pattern):
    db.flush()
    rows = db.execute(
        select(PatternMember.conversation_id, Conversation.user_id, ConversationAnalysis.has_frustration)
        .join(Conversation, Conversation.id == PatternMember.conversation_id)
        .outerjoin(ConversationAnalysis, ConversationAnalysis.conversation_id == PatternMember.conversation_id)
        .where(PatternMember.pattern_id == pattern.id)
    ).all()
    convs = {r[0]: (r[1], bool(r[2])) for r in rows}
    pattern.conversation_count = len(convs)
    pattern.user_count = len({u for u, _ in convs.values() if u})
    pattern.frustrated_pct = round(100 * sum(1 for _, f in convs.values() if f) / len(convs), 1) if convs else 0.0
    pattern.updated_at = utcnow()


def classify_items(db: Session, conv_ids: list[str]) -> list[dict]:
    items = []
    for cid in conv_ids:
        c = db.get(Conversation, cid)
        a = db.get(ConversationAnalysis, cid) if c else None  # direct get: c.analysis may be a stale cached None
        if not a:
            continue
        items.append({"id": cid, "summary": a.summary, "intent": a.intent,
                      "last_turns": [f"{m.role}: {m.content}" for m in c.messages[-6:]]})
    return items


async def apply_custom_pattern(db: Session, llm: LLM, pattern: Pattern, conv_ids: list[str]):
    items = classify_items(db, conv_ids)
    if items:
        results = await llm.classify_custom(pattern.name, pattern.query_text or pattern.description, items)
        have = {m.conversation_id for m in db.scalars(select(PatternMember).where(PatternMember.pattern_id == pattern.id))}
        for it, r in zip(items, results):
            if r.match and it["id"] not in have:
                db.add(PatternMember(pattern_id=pattern.id, conversation_id=it["id"], score=r.confidence or 1.0))
                have.add(it["id"])
    refresh_pattern_stats(db, pattern)
    db.commit()


async def create_custom_pattern(db: Session, llm: LLM, name: str, description: str) -> Pattern:
    p = Pattern(kind="custom", name=name.strip(), description=description.strip(), query_text=description.strip(), top_terms_json="[]")
    db.add(p)
    db.commit()
    all_ids = [r[0] for r in db.execute(select(ConversationAnalysis.conversation_id)).all()]
    await apply_custom_pattern(db, llm, p, all_ids)
    return p


# ---------------------------------------------------------------- stats
def compute_stats(db: Session) -> dict:
    total = db.scalar(select(func.count()).select_from(Conversation)) or 0
    users = db.scalar(select(func.count(func.distinct(Conversation.user_id)))) or 0
    analyzed = db.scalar(select(func.count()).select_from(ConversationAnalysis)) or 0

    def pct(col):
        n = db.scalar(select(func.count()).select_from(ConversationAnalysis).where(col.is_(True))) or 0
        return round(100 * n / analyzed, 1) if analyzed else 0.0

    A = ConversationAnalysis
    unresolved = db.scalar(select(func.count()).select_from(A).where(A.outcome.in_(["unresolved", "abandoned"]))) or 0
    rates = {
        "frustration": pct(A.has_frustration),
        "rephrasing": pct(A.has_rephrasing),
        "correction": pct(A.has_correction),
        "unresolved_outcome": round(100 * unresolved / analyzed, 1) if analyzed else 0.0,
        "feature_request": pct(A.has_feature_request),
        "bug": pct(A.has_bug_report),
        "hallucination": pct(A.has_hallucination),
        "churn": pct(A.has_churn_signal),
        "silent_failure": pct(A.silent_failure),
    }
    # conversations per day stacked by outcome
    rows = db.execute(
        select(Conversation.first_message_at, Conversation.created_at, A.outcome)
        .outerjoin(A, A.conversation_id == Conversation.id)
    ).all()
    per_day: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for fm, ca, outcome in rows:
        day = (fm or ca or datetime.utcnow()).date().isoformat()
        per_day[day][outcome or "not analyzed"] += 1
    days = sorted(per_day)
    outcomes = ["resolved", "partial", "unresolved", "abandoned", "not analyzed"]
    chart = {"labels": days, "datasets": [{"outcome": o, "data": [per_day[d].get(o, 0) for d in days]} for o in outcomes]}
    top = db.scalars(select(Pattern).order_by(Pattern.conversation_count.desc(), Pattern.id).limit(5)).all()
    return {
        "conversations": total, "users": users, "analyzed": analyzed, "signal_rates": rates, "per_day": chart,
        "top_patterns": [{"id": p.id, "name": p.name, "kind": p.kind, "conversations": p.conversation_count, "users": p.user_count} for p in top],
    }
