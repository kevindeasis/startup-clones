"""FastAPI app: scoring API, guarded chat, review queue dashboard, metrics."""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Iterator

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import alerts, db, metrics
from .calibrate import MIN_LABELED, calibrate
from .config import get_settings
from .generator import generate_answer
from .judge import get_judge, split_sentences
from .policies import apply_policy
from .schemas import ChatRequest, ChatResponse, ReviewRequest, ScoreRequest, ScoreResponse

BASE = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE / "templates"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Latent clone", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def require_key(request: Request) -> None:
    """If LATENT_API_KEY is set, require it as a Bearer token on /v1/*."""
    key = get_settings().api_key
    if key and request.headers.get("authorization", "") != f"Bearer {key}":
        raise HTTPException(status_code=401, detail="invalid or missing bearer token")


v1 = APIRouter(prefix="/v1", dependencies=[Depends(require_key)])


def run_score(prompt: str, answer: str, sources: list[str], policy: str) -> ScoreResponse:
    settings = get_settings()
    threshold = db.get_threshold()
    started = time.perf_counter()
    result = get_judge(settings).score(prompt, answer, sources)
    judge_seconds = time.perf_counter() - started
    metrics.JUDGE_LATENCY.observe(judge_seconds)

    flagged = result.score >= threshold
    action, final_answer = apply_policy(settings, flagged, policy, prompt, answer, sources)
    latency_ms = int((time.perf_counter() - started) * 1000)
    rid = db.insert_answer(
        prompt=prompt, answer=answer, sources=sources, score=result.score, threshold=threshold,
        flagged=flagged, risky_sentence=result.risky_sentence,
        source_sentence=result.source_sentence, failure_type=result.failure_type,
        explanation=result.explanation, policy=policy, action=action,
        final_answer=final_answer, judge_model=result.model, latency_ms=latency_ms,
    )
    metrics.ANSWERS_SCORED.inc()
    if flagged:
        metrics.ANSWERS_FLAGGED.labels(failure_type=result.failure_type).inc()
    alerts.maybe_alert(settings)
    return ScoreResponse(
        id=rid, score=result.score, flagged=flagged, threshold=threshold,
        risky_sentence=result.risky_sentence, source_sentence=result.source_sentence,
        failure_type=result.failure_type, explanation=result.explanation, action=action,
        final_answer=final_answer, latency_ms=latency_ms,
    )


@v1.post("/score", response_model=ScoreResponse)
def score(req: ScoreRequest) -> ScoreResponse:
    return run_score(req.prompt, req.answer, req.sources, req.policy)


@v1.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest) -> ChatResponse:
    if req.answer_override is not None:
        raw = req.answer_override
    else:
        try:
            raw = generate_answer(get_settings(), req.question, req.sources)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"base model failed: {exc}") from exc
    return ChatResponse(
        question=req.question, raw_answer=raw,
        guarded=run_score(req.question, raw, req.sources, req.policy),
    )


@v1.post("/reviews")
def review(req: ReviewRequest) -> dict:
    if not db.set_review(req.id, req.decision):
        raise HTTPException(status_code=404, detail="answer not found")
    metrics.REVIEWS.labels(decision=req.decision).inc()
    return {"id": req.id, "review_status": req.decision}


@v1.post("/calibrate")
def calibrate_route() -> dict:
    rows = db.labeled_rows()
    if len(rows) < MIN_LABELED:
        raise HTTPException(
            status_code=400,
            detail=f"Need at least {MIN_LABELED} reviewed answers to calibrate; have {len(rows)}.",
        )
    result = calibrate(rows)
    db.set_threshold(result["threshold"])
    return result


@v1.get("/stats")
def stats() -> dict:
    return db.stats()


@v1.get("/export.jsonl")
def export() -> StreamingResponse:
    def lines() -> Iterator[str]:
        for r in db.iter_labeled():
            yield json.dumps({
                "prompt": r["prompt"], "answer": r["answer"], "sources": r["sources"],
                "label": "hallucinated" if r["review_status"] == "confirmed" else "grounded",
                "score": r["score"], "failure_type": r["failure_type"],
                "risky_sentence": r["risky_sentence"],
            }) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


app.include_router(v1)


@app.get("/metrics")
def metrics_route() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "mock_mode": get_settings().mock_mode}


def _highlight(row: dict) -> list[dict]:
    risky = row.get("risky_sentence")
    return [{"text": s, "risky": s == risky} for s in split_sentences(row["answer"])]


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, tab: str = "pending") -> HTMLResponse:
    if tab not in ("pending", "reviewed", "all"):
        tab = "pending"
    rows = db.list_answers(tab)
    for r in rows:
        r["segments"] = _highlight(r)
    return templates.TemplateResponse(
        request, "index.html",
        {"rows": rows, "tab": tab, "stats": db.stats(), "mock_mode": get_settings().mock_mode},
    )
