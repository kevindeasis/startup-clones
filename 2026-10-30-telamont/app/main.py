import json
import re
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import pipeline, retrieval
from .db import UPLOAD_DIR, get_session, init_db
from .extract import ExtractionError, chunk_pages, extract_pages, guess_kind
from .llm import LLMConfigError, LLMError, provider_config
from .models import Chunk, Citation, Document, Project, Question, Risk, now

STATIC = Path(__file__).parent / "static"
KINDS = {"contract", "spec", "drawing", "schedule", "other"}
STATUSES = {"open", "in_review", "resolved", "dismissed"}
MAX_UPLOAD = 25 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Girder", description="Telamont-style construction document risk detection", lifespan=lifespan)


@app.exception_handler(LLMConfigError)
async def _cfg_err(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(LLMError)
async def _llm_err(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=502)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class RiskPatch(BaseModel):
    status: Optional[str] = None
    owner: Optional[str] = None


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


# ---------- serializers ----------
def dt(v):
    return v.isoformat() if v else None


def doc_out(d: Document) -> dict:
    return {
        "id": d.id, "project_id": d.project_id, "filename": d.filename, "kind": d.kind,
        "page_count": d.page_count, "char_count": d.char_count, "status": d.status,
        "message": d.message, "created_at": dt(d.created_at),
    }


def risk_out(session: Session, r: Risk) -> dict:
    cites = session.exec(select(Citation).where(Citation.risk_id == r.id).order_by(Citation.id)).all()
    names = {d.id: d.filename for d in session.exec(select(Document).where(Document.project_id == r.project_id))}
    return {
        "id": r.id, "project_id": r.project_id, "title": r.title, "category": r.category,
        "severity": r.severity, "description": r.description, "recommendation": r.recommendation,
        "status": r.status, "owner": r.owner, "created_at": dt(r.created_at), "updated_at": dt(r.updated_at),
        "citations": [
            {"id": c.id, "document_id": c.document_id, "filename": names.get(c.document_id, "?"),
             "page": c.page, "quote": c.quote}
            for c in cites
        ],
    }


def get_project(session: Session, pid: int) -> Project:
    p = session.get(Project, pid)
    if not p:
        raise HTTPException(404, "Project not found")
    return p


SEV_ORDER = {"high": 0, "medium": 1, "low": 2}


def list_risks(session: Session, pid: int, category=None, severity=None, status=None) -> List[dict]:
    q = select(Risk).where(Risk.project_id == pid)
    if category:
        q = q.where(Risk.category == category)
    if severity:
        q = q.where(Risk.severity == severity)
    if status:
        q = q.where(Risk.status == status)
    rows = sorted(session.exec(q).all(), key=lambda r: (SEV_ORDER.get(r.severity, 3), r.id))
    return [risk_out(session, r) for r in rows]


# ---------- routes ----------
@app.get("/api/health")
def health():
    cfg = provider_config()
    return {"ok": True, "llm_provider": cfg["provider"], "model": cfg["model"]}


@app.post("/api/projects")
def create_project(body: ProjectIn, session: Session = Depends(get_session)):
    p = Project(name=body.name.strip())
    session.add(p)
    session.commit()
    session.refresh(p)
    return {"id": p.id, "name": p.name, "created_at": dt(p.created_at)}


@app.get("/api/projects")
def projects(session: Session = Depends(get_session)):
    return [{"id": p.id, "name": p.name, "created_at": dt(p.created_at)}
            for p in session.exec(select(Project).order_by(Project.id.desc()))]


@app.get("/api/projects/{pid}")
def project_detail(pid: int, session: Session = Depends(get_session)):
    p = get_project(session, pid)
    docs = session.exec(select(Document).where(Document.project_id == pid).order_by(Document.id)).all()
    risks = session.exec(select(Risk).where(Risk.project_id == pid)).all()
    return {
        "id": p.id, "name": p.name, "created_at": dt(p.created_at),
        "documents": [doc_out(d) for d in docs],
        "counts": {
            "documents": len(docs), "risks": len(risks),
            "open_risks": sum(1 for r in risks if r.status == "open"),
            "questions": len(session.exec(select(Question).where(Question.project_id == pid)).all()),
        },
    }


@app.post("/api/projects/{pid}/documents")
async def upload_documents(
    pid: int,
    files: List[UploadFile] = File(...),
    kind: Optional[str] = Form(None),
    session: Session = Depends(get_session),
):
    get_project(session, pid)
    if kind and kind not in KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(KINDS)}")
    out = []
    for f in files:
        name = Path(f.filename or "upload").name
        data = await f.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, f"{name} exceeds {MAX_UPLOAD // 1024 // 1024} MB")
        doc = Document(project_id=pid, filename=name, kind=kind or guess_kind(name))
        try:
            pages = extract_pages(data, name)
            chunks = chunk_pages(pages)
            if not chunks:
                raise ExtractionError("No extractable text found.")
            doc.page_count, doc.char_count, doc.status = len(pages), sum(len(p) for p in pages), "extracted"
        except ExtractionError as e:
            doc.status, doc.message, chunks = "failed", str(e), []
        session.add(doc)
        session.flush()
        for pno, idx, text in chunks:
            session.add(Chunk(document_id=doc.id, page=pno, idx=idx, text=text))
        dest = UPLOAD_DIR / str(pid)
        dest.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
        (dest / f"{doc.id}_{uuid.uuid4().hex[:6]}_{safe}").write_bytes(data)
        session.commit()
        session.refresh(doc)
        out.append(doc_out(doc))
    retrieval.invalidate(pid)
    return out


@app.get("/api/projects/{pid}/documents")
def documents(pid: int, session: Session = Depends(get_session)):
    get_project(session, pid)
    return [doc_out(d) for d in session.exec(select(Document).where(Document.project_id == pid).order_by(Document.id))]


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, session: Session = Depends(get_session)):
    d = session.get(Document, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    for c in session.exec(select(Chunk).where(Chunk.document_id == doc_id)).all():
        session.delete(c)
    affected = set()
    for c in session.exec(select(Citation).where(Citation.document_id == doc_id)).all():
        affected.add(c.risk_id)
        session.delete(c)
    session.flush()
    for rid in affected:  # drop open risks that lost all evidence
        r = session.get(Risk, rid)
        if r and r.status == "open" and not session.exec(select(Citation).where(Citation.risk_id == rid)).first():
            session.delete(r)
    pid = d.project_id
    session.delete(d)
    session.commit()
    retrieval.invalidate(pid)
    return {"ok": True}


@app.post("/api/projects/{pid}/detect")
def detect(pid: int, session: Session = Depends(get_session)):
    get_project(session, pid)
    pipeline.detect(session, pid)
    return list_risks(session, pid)


@app.get("/api/projects/{pid}/risks")
def risks(pid: int, category: Optional[str] = None, severity: Optional[str] = None,
          status: Optional[str] = None, session: Session = Depends(get_session)):
    get_project(session, pid)
    return list_risks(session, pid, category or None, severity or None, status or None)


@app.patch("/api/risks/{rid}")
def patch_risk(rid: int, body: RiskPatch, session: Session = Depends(get_session)):
    r = session.get(Risk, rid)
    if not r:
        raise HTTPException(404, "Risk not found")
    if body.status is not None:
        if body.status not in STATUSES:
            raise HTTPException(400, f"status must be one of {sorted(STATUSES)}")
        r.status = body.status
    if body.owner is not None:
        r.owner = body.owner.strip() or None
    r.updated_at = now()
    session.add(r)
    session.commit()
    session.refresh(r)
    return risk_out(session, r)


@app.post("/api/risks/{rid}/notice")
def risk_notice(rid: int, session: Session = Depends(get_session)):
    r = session.get(Risk, rid)
    if not r:
        raise HTTPException(404, "Risk not found")
    return {"notice": pipeline.notice(session, r)}


@app.post("/api/projects/{pid}/ask")
def ask(pid: int, body: AskIn, session: Session = Depends(get_session)):
    get_project(session, pid)
    return pipeline.ask(session, pid, body.question.strip())


@app.get("/api/projects/{pid}/questions")
def questions(pid: int, session: Session = Depends(get_session)):
    get_project(session, pid)
    return [
        {"id": q.id, "question": q.question, "answer": q.answer,
         "citations": json.loads(q.citations_json or "[]"), "created_at": dt(q.created_at)}
        for q in session.exec(select(Question).where(Question.project_id == pid).order_by(Question.id))
    ]


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
