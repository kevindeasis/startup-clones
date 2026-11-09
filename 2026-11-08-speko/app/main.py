"""Speko-lite: a voice-model gateway (independent learning clone, not affiliated with Speko)."""
import base64
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, field_validator

from . import config, data, health
from .benchmarks import count_rows, latest_rows, run_benchmark
from .db import conn, init_db
from .gateway import AllProvidersFailed, execute_stage
from .providers import list_providers, make_eval_audio
from .routing import rank_providers

STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    health.ensure_rows()
    if count_rows() == 0:  # seed leaderboard on first start
        run_benchmark()
    yield


app = FastAPI(title="Speko-lite", version="0.1.0", lifespan=lifespan)


def _check(fn, value):
    try:
        return fn(value)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


class RouteRequest(BaseModel):
    stage: str
    language: str
    use_case: str = "general"
    priority: Literal["quality", "latency", "cost", "balanced"] = "balanced"

    _v_stage = field_validator("stage")(lambda cls, v: data.validate_stage(v))
    _v_lang = field_validator("language")(lambda cls, v: data.validate_language(v))
    _v_uc = field_validator("use_case")(lambda cls, v: data.validate_use_case(v))


class BenchRequest(BaseModel):
    languages: Optional[list[str]] = None
    stages: Optional[list[str]] = None

    @field_validator("languages")
    @classmethod
    def _l(cls, v):
        return [data.validate_language(x) for x in v] if v else v

    @field_validator("stages")
    @classmethod
    def _s(cls, v):
        return [data.validate_stage(x) for x in v] if v else v


class FaultRequest(BaseModel):
    provider: str
    mode: Literal["fail", "slow", "ok"]


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(STATIC / "index.html", media_type="text/html")


@app.get("/api/health")
def api_health():
    return {"mock_mode": config.mock_mode(), "breaker": {"threshold": config.FAIL_THRESHOLD, "open_seconds": config.OPEN_SECONDS},
            "providers": health.all_states()}


@app.get("/api/providers")
def api_providers():
    return {"mock_mode": config.mock_mode(),
            "providers": [{"name": p.name, "stage": p.stage, "mock": p.is_mock} for p in list_providers()],
            "languages": data.LANGUAGES, "use_cases": list(data.USE_CASES), "priorities": list(data.PRIORITIES)}


@app.post("/api/benchmarks/run")
def api_bench_run(req: BenchRequest = BenchRequest()):
    return run_benchmark(req.languages, req.stages)


@app.get("/api/benchmarks")
def api_bench(stage: Optional[str] = None, language: Optional[str] = None):
    if stage:
        _check(data.validate_stage, stage)
    if language:
        _check(data.validate_language, language)
    return {"results": latest_rows(stage, language)}


@app.post("/api/route")
def api_route(req: RouteRequest):
    return rank_providers(req.stage, req.language, req.use_case, req.priority)


@app.get("/api/eval-audio")
def api_eval_audio(language: str = "en", idx: int = 0):
    """A playable WAV carrying an eval-sentence id; upload it to /api/turn to exercise the audio path in mock mode."""
    _check(data.validate_language, language)
    if not 0 <= idx < len(data.EVAL_SETS[language]):
        raise HTTPException(422, f"idx must be 0..{len(data.EVAL_SETS[language]) - 1}")
    return Response(make_eval_audio(language, idx), media_type="audio/wav",
                    headers={"Content-Disposition": f'attachment; filename="eval-{language}-{idx}.wav"'})


@app.post("/api/turn")
async def api_turn(language: str = Form("en"), use_case: str = Form("general"), priority: str = Form("balanced"),
                   text: Optional[str] = Form(None), audio: Optional[UploadFile] = File(None)):
    _check(data.validate_language, language)
    _check(data.validate_use_case, use_case)
    _check(data.validate_priority, priority)
    audio_bytes = await audio.read() if audio is not None else b""
    if not audio_bytes and not (text and text.strip()):
        raise HTTPException(422, "Provide an audio file or a non-empty 'text' field")
    trace = []
    try:
        transcript, t = execute_stage("stt", language, use_case, priority,
                                      audio=audio_bytes or None, text=None if audio_bytes else text.strip())
        trace.append(t)
        reply, t = execute_stage("llm", language, use_case, priority, text=transcript)
        trace.append(t)
        wav, t = execute_stage("tts", language, use_case, priority, text=reply)
        trace.append(t)
    except AllProvidersFailed as e:
        raise HTTPException(502, {"message": str(e), "stage": e.stage, "attempts": e.attempts, "trace": trace})
    with conn() as c:
        c.execute("INSERT INTO turns(created_at,language,use_case,priority,transcript,reply,trace_json) VALUES(?,?,?,?,?,?,?)",
                  (datetime.now(timezone.utc).isoformat(), language, use_case, priority, transcript, reply, json.dumps(trace)))
    return {"transcript": transcript, "reply": reply, "audio_base64": base64.b64encode(wav).decode(),
            "audio_mime": "audio/wav", "trace": trace,
            "total_latency_ms": round(sum(x["latency_ms"] for x in trace), 1),
            "total_cost_usd": round(sum(x["cost_usd"] for x in trace), 8)}


@app.get("/api/turns")
def api_turns(limit: int = 20):
    with conn() as c:
        rows = c.execute("SELECT * FROM turns ORDER BY id DESC LIMIT ?", (max(1, min(limit, 200)),)).fetchall()
    return {"turns": [{**dict(r), "trace": json.loads(r["trace_json"]), "trace_json": None} for r in rows]}


@app.post("/api/admin/fault")
def api_fault(req: FaultRequest):
    if req.provider not in {p.name for p in list_providers()}:
        raise HTTPException(422, f"Unknown provider '{req.provider}'")
    return health.set_fault(req.provider, req.mode)


@app.post("/api/admin/reset")
def api_reset():
    health.reset_all()
    return {"ok": True}


def run() -> None:  # python -m app.main
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))


if __name__ == "__main__":
    run()
