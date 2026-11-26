from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from . import llm
from .db import Database
from .models import AskRequest, VerifyRequest
from .pipeline import ask as run_ask
from .rules import load_rules
from .verifier import verify_sql

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Proven")
rules = load_rules()
db = Database()

EXAMPLES = [
    "What was revenue by month in 2026?",
    "How many customers do we have including trials?",
    "What is our MRR by plan?",
    "How many active subscriptions do we have?",
    "How many customers do we have by country?",
    "What were total refunds in Q3 2026?",
    "How many trial accounts do we have in the US?",
    "What is our NPS?",
]


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "mock": llm.is_mock(), "model": llm.model_name()}


@app.get("/api/rules")
def get_rules():
    return {"metrics": list(rules.metrics.values()), "dimensions": list(rules.dimensions.values()),
            "invariants": list(rules.invariants.values())}


@app.get("/api/schema")
def get_schema():
    out: dict[str, dict] = {}
    for t, c, ty in db.schema():
        ent = out.setdefault(t, {"name": t, "allowed": t in rules.tables, "columns": []})
        ent["columns"].append({"name": c, "type": ty, "allowed": c in rules.tables.get(t, [])})
    return {"tables": list(out.values())}


@app.get("/api/examples")
def examples():
    return {"examples": EXAMPLES}


@app.post("/api/ask")
def ask(req: AskRequest):
    return run_ask(db, rules, req.question)


@app.post("/api/verify")
def verify(req: VerifyRequest):
    res = verify_sql(db, rules, req.sql, req.metric)
    return {"passed": res.passed, "checks": res.checks}
