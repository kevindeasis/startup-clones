"""Two-stage detection, Ask and Notice."""
import json
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from . import retrieval
from .llm import get_provider
from .models import Chunk, Citation, Document, Question, Risk, now

WINDOW_CHARS = 12_000
STAGE2_BATCH_CHARS = 60_000
CATEGORIES = {"contradiction", "contractual", "technical", "compliance"}
SEVERITIES = {"high", "medium", "low"}
NO_BASIS = "No basis found in the documents."

STAGE1_SYSTEM = """You are a construction-contract analyst. You receive excerpts (JSON) from ONE project document.
Extract (a) `requirements`: discrete, checkable requirements, each with `topic` (short normalized snake_case key such as
concrete_compressive_strength, substantial_completion_days, notice_period_days, liquidated_damages_rate, retainage_percent,
warranty_period), `value` (the literal requirement, e.g. "4,000 psi"), `clause_ref`, `page`, `quote` (VERBATIM excerpt, max 300 chars),
and `kind` (contractual|technical|compliance); and (b) `single_doc_risks` for things risky on their own (missing notice period,
unlimited liability, pay-when-paid, ambiguous scope, missing code reference), each with title, category
(contractual|technical|compliance), severity (high|medium|low), description, recommendation, page, quote (verbatim).
Only use what is in the text. Do not invent."""
STAGE1_SCHEMA = '{"requirements":[{"topic":"","value":"","clause_ref":"","page":1,"quote":"","kind":""}],"single_doc_risks":[{"title":"","category":"","severity":"","description":"","recommendation":"","page":1,"quote":""}]}'

STAGE2_SYSTEM = """You compare requirement cards extracted from different construction documents for one project.
Find CONTRADICTIONS: the same `topic` with conflicting `value` in two or more DIFFERENT documents. For each, return title,
category "contradiction", severity (high for strength/dates/money, else medium), description (state each conflicting value and
which document likely governs, using an order-of-precedence clause if one exists), recommendation, and `citations`
[{document, page, quote}] with at least 2 citations from at least 2 different documents (use the card's document filename, page and verbatim quote).
Do not report agreements or single-document topics."""
STAGE2_SCHEMA = '{"risks":[{"title":"","category":"contradiction","severity":"","description":"","recommendation":"","citations":[{"document":"","page":1,"quote":""}]}]}'

ASK_SYSTEM = """Answer the question using ONLY the provided excerpts (JSON). Cite the excerpts you used.
If the excerpts do not contain the answer, return {"answer": "", "citations": []}. Never use outside knowledge."""
ASK_SCHEMA = '{"answer":"","citations":[{"document":"","page":1,"quote":"verbatim excerpt"}]}'

NOTICE_SYSTEM = """You draft short, formal construction notices / RFI letters. Input is JSON with a risk and its citations.
Write plain text in letter form: Subject line, reference to the governing clause(s) citing document and page, statement of the issue,
requested action, and a response-deadline placeholder like [response deadline]. Do not invent facts. No markdown."""


# ---------- helpers ----------
def window_chunks(chunks: List[Chunk], limit: int = WINDOW_CHARS) -> List[List[Chunk]]:
    windows, cur, size = [], [], 0
    for c in chunks:
        if cur and size + len(c.text) > limit:
            windows.append(cur)
            cur, size = [], 0
        cur.append(c)
        size += len(c.text)
    if cur:
        windows.append(cur)
    return windows


def _s(v: Any, n: int = 0) -> str:
    t = "" if v is None else str(v).strip()
    return t[:n] if n else t


def _int(v: Any, default: int = 1) -> int:
    try:
        return max(1, int(v))
    except Exception:
        return default


def find_doc(name: str, docs: List[Document]) -> Optional[Document]:
    n = _s(name).lower()
    for d in docs:
        if d.filename.lower() == n:
            return d
    base = n.rsplit("/", 1)[-1]
    for d in docs:
        if d.filename.lower() == base:
            return d
    for d in docs:
        if n and (n in d.filename.lower() or d.filename.lower() in n):
            return d
    return None


# ---------- stage 1 ----------
def stage1(provider, doc: Document, chunks: List[Chunk]) -> Tuple[List[dict], List[dict]]:
    cards, singles = [], []
    for win in window_chunks(chunks):
        user = json.dumps(
            {
                "document": doc.filename,
                "doc_kind": doc.kind,
                "chunks": [{"page": c.page, "text": c.text} for c in win],
            }
        )
        out = provider.complete_json(STAGE1_SYSTEM, user, STAGE1_SCHEMA, task="requirements")
        out = out if isinstance(out, dict) else {}
        for r in out.get("requirements") or []:
            if not isinstance(r, dict) or not _s(r.get("topic")) or not _s(r.get("value")):
                continue
            cards.append(
                {
                    "topic": _s(r["topic"]).lower().replace(" ", "_"),
                    "value": _s(r["value"], 120),
                    "clause_ref": _s(r.get("clause_ref"), 40),
                    "page": _int(r.get("page")),
                    "quote": _s(r.get("quote"), 300),
                    "kind": _s(r.get("kind")) or "contractual",
                    "document": doc.filename,
                    "doc_kind": doc.kind,
                }
            )
        for r in out.get("single_doc_risks") or []:
            if isinstance(r, dict) and _s(r.get("title")):
                singles.append(dict(r, document=doc.filename, page=_int(r.get("page"))))
    return cards, singles


# ---------- stage 2 ----------
def _batches(cards: List[dict]) -> List[List[dict]]:
    if len(json.dumps(cards)) <= STAGE2_BATCH_CHARS:
        return [cards]
    by_topic: Dict[str, list] = defaultdict(list)
    for c in cards:
        by_topic[c["topic"]].append(c)
    batches, cur, size = [], [], 0
    for group in by_topic.values():
        gsize = len(json.dumps(group))
        if cur and size + gsize > STAGE2_BATCH_CHARS:
            batches.append(cur)
            cur, size = [], 0
        cur.extend(group)
        size += gsize
    if cur:
        batches.append(cur)
    return batches


def stage2(provider, cards: List[dict]) -> List[dict]:
    by_topic: Dict[str, set] = defaultdict(set)
    for c in cards:
        by_topic[c["topic"]].add(c["document"])
    comparable = [c for c in cards if len(by_topic[c["topic"]]) >= 2]
    risks = []
    for batch in _batches(comparable):
        compact = [
            {
                "id": i,
                "topic": c["topic"],
                "value": c["value"],
                "document": c["document"],
                "doc_kind": c["doc_kind"],
                "page": c["page"],
                "clause_ref": c["clause_ref"],
                "quote": c["quote"],
                "kind": c["kind"],
            }
            for i, c in enumerate(batch)
        ]
        out = provider.complete_json(
            STAGE2_SYSTEM, json.dumps({"cards": compact}, separators=(",", ":")), STAGE2_SCHEMA, task="contradictions"
        )
        if isinstance(out, dict):
            risks.extend(r for r in (out.get("risks") or []) if isinstance(r, dict))
    return risks


# ---------- detect ----------
def detect(session: Session, project_id: int) -> List[Risk]:
    provider = get_provider()  # raises LLMConfigError before touching data
    docs = session.exec(
        select(Document).where(Document.project_id == project_id, Document.status == "extracted")
    ).all()
    cards, raw = [], []  # raw: normalized risk dicts with citations as [{document,page,quote}]
    for d in docs:
        chunks = session.exec(select(Chunk).where(Chunk.document_id == d.id).order_by(Chunk.idx)).all()
        c, singles = stage1(provider, d, chunks)
        cards.extend(c)
        for s in singles:
            raw.append(
                {
                    "title": _s(s["title"], 200),
                    "category": _s(s.get("category")).lower(),
                    "severity": _s(s.get("severity")).lower(),
                    "description": _s(s.get("description")),
                    "recommendation": _s(s.get("recommendation")),
                    "citations": [{"document": d.filename, "page": s["page"], "quote": _s(s.get("quote"), 300)}],
                }
            )
    for r in stage2(provider, cards):
        raw.append(
            {
                "title": _s(r.get("title"), 200),
                "category": "contradiction",
                "severity": _s(r.get("severity")).lower(),
                "description": _s(r.get("description")),
                "recommendation": _s(r.get("recommendation")),
                "citations": [x for x in (r.get("citations") or []) if isinstance(x, dict)],
            }
        )

    # keep non-open risks (in_review/resolved/dismissed); replace open ones
    existing = session.exec(select(Risk).where(Risk.project_id == project_id)).all()
    kept_titles = {r.title.lower() for r in existing if r.status != "open"}
    for r in existing:
        if r.status == "open":
            for c in session.exec(select(Citation).where(Citation.risk_id == r.id)).all():
                session.delete(c)
            session.delete(r)
    session.flush()

    seen, created = set(), []
    for r in raw:
        cites = []
        for c in r["citations"]:
            d = find_doc(c.get("document"), docs)
            if d:
                cites.append((d.id, _int(c.get("page")), _s(c.get("quote"), 300)))
        if not r["title"] or not cites:
            continue
        if r["category"] == "contradiction" and len({c[0] for c in cites}) < 2:
            continue  # a contradiction needs >= 2 documents
        key = (r["title"].lower(), cites[0])
        if key in seen or r["title"].lower() in kept_titles:
            continue
        seen.add(key)
        risk = Risk(
            project_id=project_id,
            title=r["title"],
            category=r["category"] if r["category"] in CATEGORIES else "contractual",
            severity=r["severity"] if r["severity"] in SEVERITIES else "medium",
            description=r["description"],
            recommendation=r["recommendation"],
        )
        session.add(risk)
        session.flush()
        for did, page, quote in cites:
            session.add(Citation(risk_id=risk.id, document_id=did, page=page, quote=quote))
        created.append(risk)
    session.commit()
    return created


# ---------- ask ----------
def ask(session: Session, project_id: int, question: str) -> Dict[str, Any]:
    provider = get_provider()
    hits = retrieval.retrieve(session, project_id, question, k=6)
    answer, cites = NO_BASIS, []
    if hits:
        user = json.dumps(
            {
                "question": question,
                "excerpts": [{"document": h["document"], "page": h["page"], "text": h["text"]} for h in hits],
            }
        )
        out = provider.complete_json(ASK_SYSTEM, user, ASK_SCHEMA, task="ask")
        out = out if isinstance(out, dict) else {}
        text = _s(out.get("answer"))
        if text and not text.lower().startswith("no basis"):
            answer = text
            by_name = {h["document"]: h["document_id"] for h in hits}
            for c in out.get("citations") or []:
                if not isinstance(c, dict):
                    continue
                name = _s(c.get("document"))
                did = by_name.get(name) or next(
                    (v for k, v in by_name.items() if name and (name.lower() in k.lower() or k.lower() in name.lower())),
                    None,
                )
                if did is not None:
                    cites.append(
                        {"document_id": did, "filename": next(k for k, v in by_name.items() if v == did),
                         "page": _int(c.get("page")), "quote": _s(c.get("quote"), 400)}
                    )
    q = Question(
        project_id=project_id, question=question, answer=answer, citations_json=json.dumps(cites)
    )
    session.add(q)
    session.commit()
    return {"answer": answer, "citations": cites}


# ---------- notice ----------
def notice(session: Session, risk: Risk) -> str:
    provider = get_provider()
    rows = session.exec(select(Citation).where(Citation.risk_id == risk.id)).all()
    docs = {d.id: d for d in session.exec(select(Document).where(Document.project_id == risk.project_id))}
    cites = [
        {"document": docs[c.document_id].filename if c.document_id in docs else "?", "page": c.page, "quote": c.quote}
        for c in rows
    ]
    user = json.dumps(
        {
            "risk": {
                "title": risk.title,
                "category": risk.category,
                "severity": risk.severity,
                "description": risk.description,
                "recommendation": risk.recommendation,
            },
            "citations": cites,
        }
    )
    return provider.complete_text(NOTICE_SYSTEM, user, task="notice").strip()
