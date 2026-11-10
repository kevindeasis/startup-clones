import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from . import db, demo, ingest, llm, notes, qa, targeting

BASE = Path(__file__).parent


@asynccontextmanager
async def lifespan(app):
    db.init_db()
    yield


app = FastAPI(title="IR Desk (independent Collar AI learning clone)", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")
DESK_HISTORY: dict[str, list[dict]] = {}


def page(request: Request, name: str, **ctx):
    db.init_db()
    return templates.TemplateResponse(request, name, {"mock": llm.is_mock(), **ctx})


class QAIn(BaseModel):
    question: str
    mode: str = "earnings-call"


class DeskIn(BaseModel):
    question: str
    session_id: str | None = None


class NotesIn(BaseModel):
    notes: str


# ---------- API ----------
@app.get("/health")
def health():
    return {"status": "ok", "mock_mode": llm.is_mock()}


@app.post("/api/demo/load")
def api_demo():
    db.init_db()
    return demo.load_demo()


@app.post("/api/documents")
async def api_upload(file: UploadFile = File(...), kind: str = Form("other"), public: bool = Form(False), title: str = Form("")):
    db.init_db()
    data = await file.read()
    try:
        return ingest.ingest_file(file.filename or "upload.txt", data, kind, public, title or None)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}")


@app.get("/api/documents")
def api_docs():
    return db.rows("SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id=d.id) AS chunks FROM documents d ORDER BY d.id")


@app.post("/api/documents/{doc_id}/toggle-public")
def api_toggle(doc_id: int):
    with db.connect() as c:
        c.execute("UPDATE documents SET public = 1 - public WHERE id=?", (doc_id,))
    d = db.one("SELECT * FROM documents WHERE id=?", (doc_id,))
    if not d:
        raise HTTPException(404, "document not found")
    return d


@app.delete("/api/documents/{doc_id}")
def api_delete_doc(doc_id: int):
    with db.connect() as c:
        c.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    return {"deleted": doc_id}


@app.post("/api/qa")
def api_qa(body: QAIn):
    if not body.question.strip():
        raise HTTPException(400, "question is required")
    mode = body.mode if body.mode in ("earnings-call", "front-desk") else "earnings-call"
    res = qa.answer_question(body.question, mode=mode, public_only=(mode == "front-desk"))
    qa.log_qa(mode, body.question, res)
    return res


@app.post("/api/desk")
def api_desk(body: DeskIn):
    if not body.question.strip():
        raise HTTPException(400, "question is required")
    sid = body.session_id or uuid.uuid4().hex
    res = qa.answer_question(body.question, mode="front-desk", public_only=True)
    # front desk never exposes internal risk flags or follow-ups
    res.pop("disclosure_risk", None)
    hist = DESK_HISTORY.setdefault(sid, [])
    hist.append({"role": "user", "text": body.question})
    hist.append({"role": "assistant", "text": res["answer"]})
    qa.log_qa("front-desk", body.question, res)
    return {**res, "session_id": sid, "history": hist}


@app.post("/api/notes")
def api_notes(body: NotesIn):
    if not body.notes.strip():
        raise HTTPException(400, "notes are required")
    db.init_db()
    return notes.process_notes(body.notes)


@app.get("/api/investors")
def api_investors():
    return notes.list_investors()


@app.get("/api/targeting")
def api_targeting(top_n: int = 10):
    return {"company": "Northwind Robotics", "weights": targeting.WEIGHTS, "mock": llm.is_mock(),
            "ranked": targeting.rank(top_n=max(1, min(top_n, 50)))}


@app.post("/api/announcement-model")
def api_announcement():
    return JSONResponse(status_code=501, content={
        "detail": "Announcement modeling (stock-reaction / market-data modeling) is not implemented in this learning clone."})


# ---------- Pages ----------
@app.get("/")
def home(request: Request):
    db.init_db()
    stats = {"documents": db.one("SELECT COUNT(*) n FROM documents")["n"], "chunks": db.one("SELECT COUNT(*) n FROM chunks")["n"],
             "investors": db.one("SELECT COUNT(*) n FROM investors")["n"], "interactions": db.one("SELECT COUNT(*) n FROM interactions")["n"],
             "qa": db.one("SELECT COUNT(*) n FROM qa_log")["n"]}
    return page(request, "index.html", stats=stats, active="home")


@app.get("/docs-library")
def docs_page(request: Request):
    return page(request, "docs.html", active="docs")


@app.get("/qa")
def qa_page(request: Request):
    return page(request, "qa.html", active="qa")


@app.get("/desk")
def desk_page(request: Request):
    return page(request, "desk.html", active="desk")


@app.get("/investors")
def investors_page(request: Request):
    return page(request, "investors.html", investors=notes.list_investors(), active="investors")


@app.get("/investors/{inv_id}")
def investor_page(request: Request, inv_id: int):
    db.init_db()
    inv = notes.get_investor(inv_id)
    if not inv:
        raise HTTPException(404, "investor not found")
    return page(request, "investor.html", inv=inv, active="investors")


@app.get("/targeting")
def targeting_page(request: Request):
    return page(request, "targeting.html", active="targeting")


@app.get("/notes")
def notes_page(request: Request):
    return page(request, "notes.html", active="notes")
