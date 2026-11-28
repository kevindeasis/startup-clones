"""FastAPI app factory: routes, static UI, startup."""
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import discovery as discovery_mod
from .db import Database, turn_trace
from .holdout import assign
from .llm import make_llm
from .models import (MAX_TRACE_BYTES, ActivateRequest, AgentCreate, AgentPatch, CaptureRequest, ContextRequest,
                     CorrectionCreate, CorrectionPatch, DiscoverRequest, Outcome)
from .report import build_report
from .triggers import evaluate, preview as run_preview

STATIC = Path(__file__).parent / "static"


def create_app(db: Optional[Database] = None, llm=None, api_key: Optional[str] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        if getattr(app.state, "db", None) is None:
            app.state.db = Database(os.environ.get("STEER_DB", "./.steer/steer.db"))
        if getattr(app.state, "llm", None) is None:
            app.state.llm = make_llm()
        yield

    app = FastAPI(title="Steer (Mirrors clone)", version="0.1.0", lifespan=lifespan)
    app.state.db = db
    app.state.llm = llm
    if db is not None and llm is None:
        app.state.llm = make_llm()

    def DB() -> Database:
        return app.state.db

    def LLM():
        return app.state.llm

    def auth(x_steer_key: Optional[str] = Header(default=None)):
        expected = api_key or os.environ.get("STEER_API_KEY", "dev")
        if x_steer_key != expected:
            raise HTTPException(401, "missing or invalid X-Steer-Key")

    r = APIRouter(prefix="/v1", dependencies=[Depends(auth)])

    def agent_or_404(aid):
        a = DB().get_agent(aid)
        if not a:
            raise HTTPException(404, f"agent {aid} not found")
        return a

    def corr_or_404(cid):
        c = DB().get_correction(cid)
        if not c:
            raise HTTPException(404, f"correction {cid} not found")
        return c

    def turn_or_404(tid):
        t = DB().get_turn(tid)
        if not t:
            raise HTTPException(404, f"turn {tid} not found")
        return t

    def turn_out(row, full=False):
        msgs = json.loads(row["messages_json"])
        users = [m for m in msgs if m["role"] == "user"]
        out = {"trace_id": row["trace_id"], "agent_id": row["agent_id"], "conversation_id": row["conversation_id"],
               "revision": row["revision"], "entry_point": row["entry_point"], "user_id": row["user_id"],
               "user_segment": row["user_segment"], "terminal": row["terminal"], "final": bool(row["final"]),
               "outcome_success": None if row["outcome_success"] is None else bool(row["outcome_success"]),
               "outcome_note": row["outcome_note"], "latency_ms": row["latency_ms"],
               "created_at": row["created_at"], "n_messages": len(msgs),
               "last_user_message": (users[-1]["content"] if users else "")[:200]}
        if full:
            out["messages"] = msgs
        return out

    # ---------- agents
    @r.get("/agents")
    def list_agents():
        return DB().list_agents()

    @r.post("/agents")
    def create_agent(body: AgentCreate):
        return DB().create_agent(body.name, body.mode, body.system_prompt_hint)

    @r.get("/agents/{aid}")
    def get_agent(aid: str):
        return agent_or_404(aid)

    @r.patch("/agents/{aid}")
    def patch_agent(aid: str, body: AgentPatch):
        agent_or_404(aid)
        return DB().patch_agent(aid, body.name, body.mode)

    # ---------- capture + turns
    @r.post("/traces")
    def capture(body: CaptureRequest):
        agent_or_404(body.agentId)
        trace = body.trace.to_dict()
        if len(json.dumps(trace).encode()) > MAX_TRACE_BYTES:
            raise HTTPException(413, "trace exceeds 1,000,000 bytes")
        outcome = body.outcome.model_dump() if body.outcome else None
        status = DB().upsert_turn(body.agentId, trace, body.final, body.terminal, outcome)
        return {"status": "accepted", "traceId": trace["id"], "ingestion": {"status": status}}

    @r.get("/agents/{aid}/turns")
    def turns(aid: str, limit: int = Query(50, ge=1, le=500), conversationId: Optional[str] = None,
              failed_only: bool = False):
        agent_or_404(aid)
        return [turn_out(t) for t in DB().list_turns(aid, limit, conversationId, failed_only)]

    @r.get("/turns/{tid}")
    def get_turn(tid: str):
        return turn_out(turn_or_404(tid), full=True)

    @r.post("/turns/{tid}/outcome")
    def set_outcome(tid: str, body: Outcome):
        turn_or_404(tid)
        return turn_out(DB().set_outcome(tid, body.success, body.note))

    @r.post("/turns/{tid}/judge")
    def judge(tid: str):
        row = turn_or_404(tid)
        if not row["final"]:
            raise HTTPException(409, "turn is not final")
        if row["outcome_success"] is not None:
            return {**turn_out(row), "judged": False}
        try:
            res = LLM().judge(turn_trace(row))
        except Exception as e:
            raise HTTPException(502, f"judge failed: {e}")
        return {**turn_out(DB().set_outcome(tid, res["success"], res["note"])), "judged": True}

    # ---------- context
    @r.post("/context")
    def context(body: ContextRequest):
        t0 = time.monotonic()
        agent = agent_or_404(body.agentId)
        mode = agent["mode"]

        def done(text="", delivery="accepted", reason="", ids=()):
            return {"context": text, "mode": mode, "delivery": delivery, "reason": reason,
                    "elapsed_ms": int((time.monotonic() - t0) * 1000), "corrections": list(ids)}

        if mode == "off":
            return done(reason="agent mode is off")
        deadline = t0 + body.timeout_ms / 1000
        trace = body.trace.to_dict()
        texts, ids, unconfirmed = [], [], None
        for c in DB().list_corrections(body.agentId, status="active"):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                unconfirmed = "time budget exhausted"
                break
            llm = LLM()
            ev = evaluate(c["trigger"], trace,
                          lambda tr, s, k, rem=remaining: llm.classify(tr, s, k, timeout=rem))
            if ev["error"]:
                unconfirmed = ev["situation"]["reason"]
            if not ev["matched"]:
                continue
            group = assign(body.trace.conversationId, c["id"], c["holdout_pct"])
            deliver = mode == "active" and group == "treatment"
            DB().add_delivery(c["id"], body.trace.id, body.trace.conversationId, group, deliver, mode)
            if deliver:
                texts.append(c["guidance"])
                ids.append(c["id"])
        text = ("Guidance for this situation:\n" + "\n".join(f"- {g}" for g in texts)) if texts else ""
        if unconfirmed:
            return done(text, "unconfirmed", unconfirmed, ids)
        reason = ("delivered" if texts else "shadow mode: evaluated only" if mode == "shadow"
                  else "no matching correction for this conversation")
        return done(text, "accepted", reason, ids)

    # ---------- discovery
    @r.post("/agents/{aid}/discover")
    def discover(aid: str, body: Optional[DiscoverRequest] = None):
        agent_or_404(aid)
        return discovery_mod.discover(DB(), LLM(), aid, (body or DiscoverRequest()).max_turns)

    @r.get("/agents/{aid}/mistakes")
    def mistakes(aid: str):
        agent_or_404(aid)
        return DB().list_mistakes(aid)

    # ---------- corrections
    @r.get("/agents/{aid}/corrections")
    def list_corrections(aid: str):
        agent_or_404(aid)
        return DB().list_corrections(aid)

    @r.post("/corrections")
    def create_correction(body: CorrectionCreate):
        agent_or_404(body.agentId)
        return DB().create_correction(body.agentId, body.title, body.guidance, body.trigger.to_dict())

    @r.get("/corrections/{cid}")
    def get_correction(cid: str):
        return corr_or_404(cid)

    @r.patch("/corrections/{cid}")
    def patch_correction(cid: str, body: CorrectionPatch):
        corr_or_404(cid)
        return DB().patch_correction(cid, body.title, body.guidance,
                                     body.trigger.to_dict() if body.trigger else None)

    @r.delete("/corrections/{cid}")
    def delete_correction(cid: str):
        corr_or_404(cid)
        DB().delete_correction(cid)
        return {"deleted": True}

    @r.post("/corrections/{cid}/preview")
    def preview(cid: str):
        c = corr_or_404(cid)
        rows = DB().list_turns(c["agent_id"], limit=2000, newest_first=False)
        turns_ = [(row, turn_trace(row)) for row in rows]
        others = [o for o in DB().list_corrections(c["agent_id"], status="active") if o["id"] != cid]
        llm = LLM()
        res = run_preview(c["trigger"], turns_, lambda tr, s, k: llm.classify(tr, s, k, timeout=20), others)
        res["version"] = c["version"]
        return DB().set_preview(cid, res)["preview"] | {"correction_id": cid, "status": DB().get_correction(cid)["status"]}

    @r.post("/corrections/{cid}/activate")
    def activate(cid: str, body: Optional[ActivateRequest] = None):
        c = corr_or_404(cid)
        if not c["preview"] or c["preview"].get("version") != c["version"]:
            raise HTTPException(409, "preview this version of the correction before activating")
        out = DB().set_status(cid, "active", (body or ActivateRequest()).holdout_pct)
        out["agent_mode"] = DB().get_agent(c["agent_id"])["mode"]
        return out

    @r.post("/corrections/{cid}/pause")
    def pause(cid: str):
        corr_or_404(cid)
        return DB().set_status(cid, "paused")

    @r.get("/corrections/{cid}/report")
    def report(cid: str):
        return build_report(DB(), corr_or_404(cid))

    app.include_router(r)

    @app.get("/healthz")
    def healthz():
        return {"ok": True, "mock": bool(getattr(LLM(), "mock", True)) if app.state.llm else True}

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


app = create_app()
