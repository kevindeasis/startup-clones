"""Chronolog - FastAPI app."""
import json
import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import pymupdf
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from . import config, db, export, pdfutil, pipeline
from .llm import CATEGORIES, SIGNIFICANCE
from .dates import normalize_date

BASE = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE / "templates"))
SAMPLE_CASE_NAME = "Ellison v. St. Mary's (sample)"


def create_case(name, claimant="", matter_type="", firm_name="", report_title="", footer="") -> int:
    return db.execute(
        "INSERT INTO cases(name,claimant,matter_type,firm_name,report_title,footer,created_at,status) VALUES(?,?,?,?,?,?,?,'new')",
        (name, claimant, matter_type, firm_name or "Your Firm LLP", report_title or "Medical Chronology Report",
         footer or "Confidential - prepared for expert review", db.now()))


def add_pdf(case_id: int, filename: str, path: Path) -> int:
    with pymupdf.open(str(path)) as d:
        n = len(d)
    return db.execute("INSERT INTO files(case_id,filename,path,page_count,uploaded_at) VALUES(?,?,?,?,?)",
                      (case_id, filename, str(path), n, db.now()))


def load_sample_into(case_id: int):
    from scripts.make_sample_records import build_bundle
    src = config.data_dir() / "sample"
    paths = build_bundle(src)
    dest = config.data_dir() / "uploads" / str(case_id)
    dest.mkdir(parents=True, exist_ok=True)
    existing = {f["filename"] for f in db.q("SELECT filename FROM files WHERE case_id=?", (case_id,))}
    for p in paths:
        if p.name in existing:
            continue
        shutil.copy(p, dest / p.name)
        add_pdf(case_id, p.name, dest / p.name)


def seed_if_empty():
    if not db.q("SELECT id FROM cases LIMIT 1"):
        cid = create_case(SAMPLE_CASE_NAME, "Margaret Ellison", "Medical malpractice (orthopaedic)", "Hartwell & Reyes LLP",
                          "Medical Chronology Report", "Hartwell & Reyes LLP - Privileged & Confidential - Attorney Work Product")
        load_sample_into(cid)


@asynccontextmanager
async def lifespan(app):
    db.init_db()
    seed_if_empty()
    yield


app = FastAPI(title="Chronolog", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def get_case(case_id: int) -> dict:
    c = db.q("SELECT * FROM cases WHERE id=?", (case_id,), one=True)
    if not c:
        raise HTTPException(404, "case not found")
    return c


def get_event(event_id: int) -> dict:
    e = db.q("SELECT * FROM events WHERE id=?", (event_id,), one=True)
    if not e:
        raise HTTPException(404, "event not found")
    return e


def ev_out(e: dict) -> dict:
    e = dict(e)
    e["source_pages"] = db.jloads(e.get("source_pages"), []) if isinstance(e.get("source_pages"), str) or e.get("source_pages") is None else e["source_pages"]
    e["verified"] = bool(e["verified"])
    return e


@app.get("/health")
def health():
    return {"status": "ok", "mode": config.llm_mode(), "model": config.model_name() if config.llm_mode() == "live" else "mock-heuristic"}


# ------------------------------------------------------------------ HTML
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    cases = db.q("SELECT * FROM cases ORDER BY id DESC")
    for c in cases:
        c["stats"] = export.case_stats(c["id"])
        c["files"] = db.q("SELECT COUNT(*) n FROM files WHERE case_id=?", (c["id"],), one=True)["n"]
    return templates.TemplateResponse(request, "index.html", {"cases": cases, "mode": config.llm_mode()})


@app.get("/cases/{case_id}", response_class=HTMLResponse)
def case_page(request: Request, case_id: int):
    case = get_case(case_id)
    bates = {r["bates"]: r["id"] for r in db.q("SELECT id,bates FROM pages WHERE case_id=? AND bates IS NOT NULL", (case_id,))}
    events = [ev_out(e) for e in export.load_events(case_id)]
    names = {e["id"]: e for e in events}
    conflicts = db.q("SELECT * FROM conflicts WHERE case_id=? ORDER BY resolved, id", (case_id,))
    for c in conflicts:
        c["event_ids"] = db.jloads(c["event_ids"], [])
    return templates.TemplateResponse(request, "case.html", {
        "case": case, "events": events, "bates": bates, "conflicts": conflicts, "stats": export.case_stats(case_id),
        "files": db.q("SELECT * FROM files WHERE case_id=? ORDER BY id", (case_id,)), "mode": config.llm_mode(),
        "categories": sorted(CATEGORIES), "levels": ["low", "medium", "high"], "progress": pipeline.get_progress(case_id),
        "event_names": names})


@app.get("/cases/{case_id}/pages", response_class=HTMLResponse)
def pages_page(request: Request, case_id: int):
    case = get_case(case_id)
    docs = db.q("SELECT * FROM documents WHERE case_id=? ORDER BY order_index", (case_id,))
    for d in docs:
        d["pages"] = db.q("SELECT p.*, f.filename FROM pages p JOIN files f ON f.id=p.file_id WHERE p.document_id=? ORDER BY p.bates", (d["id"],))
    removed = db.q("SELECT p.*, f.filename FROM pages p JOIN files f ON f.id=p.file_id WHERE p.case_id=? AND (p.is_blank=1 OR p.is_duplicate=1) "
                   "ORDER BY p.file_id, p.page_index", (case_id,))
    return templates.TemplateResponse(request, "pages.html", {"case": case, "docs": docs, "removed": removed,
                                                              "stats": export.case_stats(case_id), "mode": config.llm_mode()})


# ------------------------------------------------------------------ cases / files
@app.post("/cases")
def post_case(name: str = Form(...), claimant: str = Form(""), matter_type: str = Form(""), firm_name: str = Form(""),
              report_title: str = Form(""), footer: str = Form("")):
    if not name.strip():
        raise HTTPException(422, "name required")
    return {"id": create_case(name.strip(), claimant, matter_type, firm_name, report_title, footer)}


@app.post("/cases/{case_id}/files")
async def upload_files(case_id: int, files: List[UploadFile] = File(...)):
    get_case(case_id)
    dest = config.data_dir() / "uploads" / str(case_id)
    dest.mkdir(parents=True, exist_ok=True)
    added = []
    for f in files:
        data = await f.read()
        name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(f.filename or "upload.pdf").name) or "upload.pdf"
        path = dest / name
        path.write_bytes(data)
        try:
            add_pdf(case_id, name, path)
        except Exception:
            path.unlink(missing_ok=True)
            raise HTTPException(400, f"{name} is not a readable PDF")
        added.append(name)
    return {"added": added}


@app.post("/cases/{case_id}/sample")
def load_sample(case_id: int):
    get_case(case_id)
    load_sample_into(case_id)
    return {"files": [f["filename"] for f in db.q("SELECT filename FROM files WHERE case_id=?", (case_id,))]}


@app.post("/cases/{case_id}/paginate", status_code=202)
def paginate(case_id: int, bg: BackgroundTasks):
    get_case(case_id)
    if not db.q("SELECT id FROM files WHERE case_id=? LIMIT 1", (case_id,)):
        raise HTTPException(400, "upload files first")
    pipeline.set_progress(case_id, stage="paginating", done=0, total=0, message="Queued")
    bg.add_task(pipeline.paginate_case, case_id)
    return {"status": "started"}


@app.post("/cases/{case_id}/chronology", status_code=202)
def chronology(case_id: int, bg: BackgroundTasks):
    get_case(case_id)
    if not db.q("SELECT id FROM documents WHERE case_id=? LIMIT 1", (case_id,)):
        raise HTTPException(400, "paginate first")
    pipeline.set_progress(case_id, stage="chronology", done=0, total=0, message="Queued")
    bg.add_task(pipeline.build_chronology, case_id)
    return {"status": "started"}


@app.get("/cases/{case_id}/status")
def status(case_id: int):
    case = get_case(case_id)
    p = pipeline.get_progress(case_id)
    return {"case_status": case["status"], **p, "stats": export.case_stats(case_id)}


# ------------------------------------------------------------------ pages
@app.get("/pages/{page_id}.png")
def page_png(page_id: int, thumb: int = 0):
    p = db.q("SELECT p.*, f.path fpath FROM pages p JOIN files f ON f.id=p.file_id WHERE p.id=?", (page_id,), one=True)
    if not p:
        raise HTTPException(404, "page not found")
    out = config.data_dir() / "pages" / str(p["case_id"]) / (f"{page_id}{'_t' if thumb else ''}.png")
    if not out.exists():
        pdfutil.render_png(p["fpath"], p["page_index"], out, zoom=0.35 if thumb else 1.5)
        if not thumb:
            db.execute("UPDATE pages SET png_path=? WHERE id=?", (str(out), page_id))
    return FileResponse(str(out), media_type="image/png")


@app.get("/api/pages/{page_id}")
def api_page(page_id: int, event_id: Optional[int] = None, quote: Optional[str] = None):
    p = db.q("SELECT id,case_id,bates,text,doc_type,facility,service_date,page_index,is_blank,is_duplicate FROM pages WHERE id=?",
             (page_id,), one=True)
    if not p:
        raise HTTPException(404, "page not found")
    if event_id is not None:
        e = db.q("SELECT quote FROM events WHERE id=?", (event_id,), one=True)
        quote = e["quote"] if e else quote
    p["quote"] = quote or ""
    p["quote_found"] = bool(quote) and pdfutil.norm_text(quote) in pdfutil.norm_text(p["text"])
    return p


# ------------------------------------------------------------------ events
class EventPatch(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    summary: Optional[str] = None
    significance: Optional[str] = None
    category: Optional[str] = None
    facility: Optional[str] = None
    provider: Optional[str] = None


@app.patch("/api/events/{event_id}")
def patch_event(event_id: int, body: EventPatch):
    get_event(event_id)
    data = body.model_dump(exclude_unset=True)
    if "date" in data and data["date"]:
        iso = normalize_date(data["date"])
        if not iso:
            raise HTTPException(422, "date must be a valid date (e.g. 2024-03-14)")
        data["date"] = iso
    if data.get("significance") and data["significance"] not in SIGNIFICANCE:
        raise HTTPException(422, "significance must be low|medium|high")
    if data.get("category") and data["category"] not in CATEGORIES:
        raise HTTPException(422, "invalid category")
    if "summary" in data and not (data["summary"] or "").strip():
        raise HTTPException(422, "summary cannot be empty")
    if data:
        sets = ", ".join(f"{k}=?" for k in data)
        # an edited event must be re-verified
        db.execute(f"UPDATE events SET {sets}, verified=0, verified_by=NULL, verified_at=NULL, updated_at=? WHERE id=?",
                   (*data.values(), db.now(), event_id))
    return ev_out(get_event(event_id))


class VerifyBody(BaseModel):
    verified: Optional[bool] = None
    by: Optional[str] = None


@app.post("/api/events/{event_id}/verify")
def verify_event(event_id: int, body: Optional[VerifyBody] = None):
    e = get_event(event_id)
    body = body or VerifyBody()
    new = (not e["verified"]) if body.verified is None else body.verified
    if new:
        db.execute("UPDATE events SET verified=1, verified_by=?, verified_at=?, updated_at=? WHERE id=?",
                   (body.by or "reviewer", db.now(), db.now(), event_id))
    else:
        db.execute("UPDATE events SET verified=0, verified_by=NULL, verified_at=NULL, updated_at=? WHERE id=?", (db.now(), event_id))
    return ev_out(get_event(event_id))


@app.delete("/api/events/{event_id}")
def delete_event(event_id: int):
    get_event(event_id)
    db.execute("DELETE FROM events WHERE id=?", (event_id,))
    return {"deleted": event_id}


class NewEvent(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    facility: Optional[str] = None
    provider: Optional[str] = None
    category: str = "other"
    summary: str
    significance: str = "low"
    source_pages: List[str] = []
    quote: str = ""


@app.post("/api/cases/{case_id}/events", status_code=201)
def add_event(case_id: int, body: NewEvent):
    get_case(case_id)
    if not body.summary.strip():
        raise HTTPException(422, "summary required")
    if body.category not in CATEGORIES or body.significance not in SIGNIFICANCE:
        raise HTTPException(422, "invalid category or significance")
    iso = normalize_date(body.date) if body.date else None
    if body.date and not iso:
        raise HTTPException(422, "invalid date")
    valid = {r["bates"] for r in db.q("SELECT bates FROM pages WHERE case_id=? AND bates IS NOT NULL", (case_id,))}
    bad = [p for p in body.source_pages if p not in valid]
    if bad:
        raise HTTPException(422, f"unknown source pages: {bad}")
    eid = db.execute("INSERT INTO events(case_id,date,time,facility,provider,category,summary,significance,quote,source_pages,verified,created_by,updated_at)"
                     " VALUES(?,?,?,?,?,?,?,?,?,?,0,'user',?)",
                     (case_id, iso, body.time, body.facility, body.provider, body.category, body.summary.strip(), body.significance,
                      body.quote[:200], json.dumps(body.source_pages), db.now()))
    return ev_out(get_event(eid))


class ResolveBody(BaseModel):
    note: str = ""


@app.post("/api/conflicts/{conflict_id}/resolve")
def resolve_conflict(conflict_id: int, body: Optional[ResolveBody] = None):
    c = db.q("SELECT * FROM conflicts WHERE id=?", (conflict_id,), one=True)
    if not c:
        raise HTTPException(404, "conflict not found")
    db.execute("UPDATE conflicts SET resolved=1, resolution_note=? WHERE id=?", ((body.note if body else "") or "", conflict_id))
    return {"id": conflict_id, "resolved": True}


# ------------------------------------------------------------------ export
def _fname(case, ext):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", case["name"]).strip("_") + "_chronology." + ext


@app.get("/cases/{case_id}/export.docx")
def export_docx(case_id: int):
    case = get_case(case_id)
    return Response(export.build_docx(case_id), headers={"Content-Disposition": f'attachment; filename="{_fname(case, "docx")}"'},
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@app.get("/cases/{case_id}/export.pdf")
def export_pdf(case_id: int):
    case = get_case(case_id)
    return Response(export.build_pdf(case_id), headers={"Content-Disposition": f'attachment; filename="{_fname(case, "pdf")}"'},
                    media_type="application/pdf")
