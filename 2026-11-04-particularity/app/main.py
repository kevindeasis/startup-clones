"""Casework: FastAPI app (API + server-rendered pages)."""
import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import analyzer, capture, db, llm, rulebook
from .models import CaseIn, ComplaintIn, DecisionIn

BASE = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE / "templates"))
demo_templates = Jinja2Templates(directory=str(BASE / "demo"))
PRIORITY_RANK = {"P1": 1, "P2": 2, "P3": 3, "P4": 4}


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Casework", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def _ctx(**kw):
    return {"mock": llm.is_mock(), "model": llm.model_name(), **kw}


def _check_url(u: str | None, field: str) -> str | None:
    if not u:
        return None
    p = urlparse(u.strip())
    if p.scheme not in ("http", "https") or not p.netloc:
        raise HTTPException(422, f"{field} must be an http(s) URL")
    return u.strip()


# ------------------------------------------------------------------ API
@app.get("/api/health")
def health():
    return {"ok": True, "mock": llm.is_mock(), "model": llm.model_name()}


@app.get("/api/cases")
def api_cases():
    return db.list_cases()


@app.get("/api/cases/{case_id}")
def api_case(case_id: int):
    c = db.get_case(case_id)
    if not c:
        raise HTTPException(404, "case not found")
    return c


@app.post("/api/cases")
async def api_create_case(body: CaseIn):
    target = _check_url(body.target_url, "target_url")
    checkout = _check_url(body.checkout_url, "checkout_url")
    cancel = _check_url(body.cancel_url, "cancel_url")
    case_id = db.create_case(target, checkout, cancel, (body.business or "").strip())
    try:
        evidence = await capture.capture_case(case_id, target, checkout, cancel)
    except Exception as e:
        db.delete_case_rows(case_id)
        raise HTTPException(502, f"capture failed: {e}")
    ev_ids = {}
    for ev in evidence:
        ev_ids[ev["kind"]] = db.add_evidence(case_id, ev)
    try:
        result = await asyncio.to_thread(analyzer.analyze_case, evidence, target)
    except Exception as e:
        raise HTTPException(502, f"analysis failed (case {case_id} kept with evidence): {e}")
    for f in result.findings:
        db.add_finding(case_id, ev_ids.get(f.evidence_kind), f.model_dump())
    db.update_case(case_id, business=(body.business or "").strip() or result.business, summary=result.summary,
                   harm_estimate_cents=result.harm_estimate_cents, priority=result.priority)
    return db.get_case(case_id)


@app.post("/api/cases/{case_id}/decisions")
def api_decision(case_id: int, body: DecisionIn):
    if not db.get_case(case_id):
        raise HTTPException(404, "case not found")
    db.add_decision(case_id, body.action, body.note)
    return db.get_case(case_id)


@app.post("/api/cases/{case_id}/letter")
async def api_letter(case_id: int):
    case = db.get_case(case_id)
    if not case:
        raise HTTPException(404, "case not found")
    body = await asyncio.to_thread(analyzer.draft_letter, case)
    lid = db.add_letter(case_id, body)
    return {"id": lid, "body": body}


@app.post("/api/complaints")
async def api_complaint(body: ComplaintIn):
    t = await asyncio.to_thread(analyzer.triage_complaint, body.text)
    case = db.find_case_by_business(t.business)
    rec = {**t.model_dump(), "text": body.text, "case_id": case["id"] if case else None}
    rec["id"] = db.add_complaint(rec)
    if case and PRIORITY_RANK[t.priority] < PRIORITY_RANK.get(case["priority"], 3):
        db.update_case(case["id"], priority=t.priority)
        rec["case_priority_raised"] = True
    return rec


@app.get("/evidence/{path:path}")
def evidence_file(path: str):
    root = db.evidence_dir().resolve()
    f = (root / path).resolve()
    if root not in f.parents or not f.is_file():
        raise HTTPException(404)
    return FileResponse(f)


# ------------------------------------------------------------------ pages
@app.get("/")
def index(request: Request):
    return templates.TemplateResponse(request, "index.html", _ctx(cases=db.list_cases()))


@app.get("/cases/{case_id}")
def case_page(request: Request, case_id: int):
    c = db.get_case(case_id)
    if not c:
        raise HTTPException(404, "case not found")
    all_ids = {i for f in c["findings"] for i in f["legal_elements"]}
    for f in c["findings"]:
        f["groups"] = rulebook.group_by_law(f["legal_elements"])
    ev_by_id = {e["id"]: e for e in c["evidence"]}
    return templates.TemplateResponse(request, "case.html", _ctx(
        case=c, ev_by_id=ev_by_id, rulebook=rulebook.load(), cited=all_ids))


@app.get("/complaints")
def complaints_page(request: Request):
    return templates.TemplateResponse(request, "complaints.html", _ctx(complaints=db.list_complaints()))


# ------------------------------------------------------------------ demo storefront
@app.get("/demo/")
def demo_home(request: Request):
    return demo_templates.TemplateResponse(request, "home.html", {})


@app.get("/demo/checkout")
def demo_checkout(request: Request):
    return demo_templates.TemplateResponse(request, "checkout.html", {})


@app.get("/demo/account")
def demo_account(request: Request):
    return demo_templates.TemplateResponse(request, "account.html", {})


@app.get("/demo/terms")
def demo_terms(request: Request):
    return demo_templates.TemplateResponse(request, "terms.html", {})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
