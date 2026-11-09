"""Claimsleuth - FastAPI app (independent educational clone of an AI claims-investigation tool)."""
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

try:  # optional
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from . import db, demo, export, extract, llm, pipeline

BASE = Path(__file__).resolve().parent
@asynccontextmanager
async def lifespan(_app):
    db.init_db()
    yield


app = FastAPI(title="Claimsleuth", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
templates = Jinja2Templates(directory=BASE / "templates")

LOBS = ["auto", "property", "homeowners", "liability", "workers_comp", "pet"]


class ClaimIn(BaseModel):
    claim_number: str
    line_of_business: str
    claimant_name: str
    loss_date: str
    description: str = ""


def _claim_or_404(cid: str) -> dict:
    c = db.get_claim(cid)
    if not c:
        raise HTTPException(404, "Claim not found")
    return c


def _claim_with_docs(cid: str) -> dict:
    c = _claim_or_404(cid)
    c["documents"] = db.list_documents(cid)
    return c


# ---- health ----------------------------------------------------------------
@app.get("/healthz")
def healthz():
    return {"ok": True, "provider": llm.provider_name()}


# ---- JSON API --------------------------------------------------------------
@app.post("/api/claims")
def api_create_claim(body: ClaimIn):
    if body.line_of_business not in LOBS:
        raise HTTPException(422, f"line_of_business must be one of {LOBS}")
    return db.create_claim(body.claim_number, body.line_of_business, body.claimant_name, body.loss_date, body.description)


@app.get("/api/claims")
def api_list_claims():
    return db.rows("SELECT * FROM claims ORDER BY created_at DESC, rowid DESC")


@app.get("/api/claims/{cid}")
def api_get_claim(cid: str):
    return _claim_with_docs(cid)


@app.post("/api/claims/{cid}/documents")
async def api_upload(cid: str, file: UploadFile = File(...), doc_type: str = Form(...)):
    claim = _claim_or_404(cid)
    limit = int(os.environ.get("MAX_UPLOAD_MB", "15")) * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"File exceeds MAX_UPLOAD_MB={os.environ.get('MAX_UPLOAD_MB', '15')}")
    try:
        return extract.ingest_document(claim, file.filename or "upload", doc_type, data)
    except extract.IngestError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/claims/{cid}/documents/{doc_id}")
def api_delete_doc(cid: str, doc_id: str):
    _claim_or_404(cid)
    d = db.get_document(doc_id)
    if not d or d["claim_id"] != cid:
        raise HTTPException(404, "Document not found")
    try:
        Path(d["storage_path"]).unlink(missing_ok=True)
    except OSError:
        pass
    db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    return {"deleted": doc_id}


@app.post("/api/claims/{cid}/investigate")
def api_investigate(cid: str, bg: BackgroundTasks):
    _claim_or_404(cid)
    running = db.row("SELECT id FROM investigations WHERE claim_id=? AND status='running'", (cid,))
    if running:
        raise HTTPException(409, "An investigation is already running for this claim")
    if not db.list_documents(cid):
        raise HTTPException(409, "Upload at least one document before investigating")
    inv_id = pipeline.start_investigation(cid)
    bg.add_task(pipeline.run_investigation, inv_id, cid)
    return {"investigation_id": inv_id}


def _inv_or_404(inv_id: str) -> dict:
    inv = db.row("SELECT * FROM investigations WHERE id=?", (inv_id,))
    if not inv:
        raise HTTPException(404, "Investigation not found")
    return inv


@app.get("/api/investigations/{inv_id}")
def api_investigation(inv_id: str):
    inv = _inv_or_404(inv_id)
    cur = inv["current_step"] or ""
    steps_done = []
    for d in db.decision_log(inv_id):
        if d["step"] not in steps_done and not cur.startswith(d["step"]):
            steps_done.append(d["step"])
    out = {"status": inv["status"], "current_step": inv["current_step"], "steps_done": steps_done,
           "steps_total": pipeline.STEPS, "error": inv["error"]}
    if inv["status"] == "done":
        out["report"] = json.loads(inv["report_json"])
    return out


@app.get("/api/investigations/{inv_id}/export.{fmt}")
def api_export(inv_id: str, fmt: str):
    inv = _inv_or_404(inv_id)
    if inv["status"] != "done":
        raise HTTPException(409, "Investigation not finished")
    r = json.loads(inv["report_json"])
    base = f"evidence-{r['claim']['claim_number']}"
    if fmt == "md":
        body, ctype = export.to_markdown(r).encode(), "text/markdown; charset=utf-8"
    elif fmt == "pdf":
        body, ctype = export.to_pdf(r), "application/pdf"
    elif fmt == "json":
        body, ctype = export.to_json(r).encode(), "application/json"
    else:
        raise HTTPException(404, "Unknown format")
    return Response(body, media_type=ctype, headers={"Content-Disposition": f'attachment; filename="{base}.{fmt}"'})


@app.post("/api/demo")
def api_demo():
    c = demo.load_demo_claim()
    return {"claim_id": c["id"], "id": c["id"]}


# ---- HTML pages ------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
def page_index(request: Request):
    return templates.TemplateResponse(request, "index.html", {"claims": api_list_claims(), "lobs": LOBS, "provider": llm.provider_name()})


@app.get("/claims/{cid}", response_class=HTMLResponse)
def page_claim(request: Request, cid: str):
    claim = _claim_with_docs(cid)
    inv = db.latest_investigation(cid)
    done = db.latest_investigation(cid, "done")
    return templates.TemplateResponse(request, "claim.html", {
        "claim": claim, "doc_types": extract.DOC_TYPES, "running": inv if inv and inv["status"] == "running" else None,
        "done": done, "provider": llm.provider_name()})


@app.get("/claims/{cid}/report", response_class=HTMLResponse)
def page_report(request: Request, cid: str):
    claim = _claim_or_404(cid)
    inv = db.latest_investigation(cid, "done")
    if not inv:
        raise HTTPException(404, "No finished investigation for this claim yet")
    r = json.loads(inv["report_json"])
    return templates.TemplateResponse(request, "report.html", {"claim": claim, "r": r, "inv": inv, "names": r.get("document_names", {}),
                                                               "provider": r.get("provider") or llm.provider_name()})
