"""ask(): interpret -> compile -> verify, with up to 3 attempts fed back to the LLM."""
from __future__ import annotations

from . import llm
from .compiler import CompileError, compile_interpretation
from .db import Database
from .rules import Rules
from .verifier import verify_sql

MAX_ATTEMPTS = 3


def filter_values(db: Database, rules: Rules) -> dict[str, list]:
    out = {}
    for name, d in rules.dimensions.items():
        if d["kind"] == "category":
            out[name] = db.distinct(d["table"], d["column"])
    return out


def ask(db: Database, rules: Rules, question: str) -> dict:
    values = filter_values(db, rules)
    attempts: list[dict] = []
    failures: list[str] = []
    base = {"mock": llm.is_mock(), "restatement": None, "sql": None, "checks": [], "rows": [], "columns": [], "attempts": attempts}
    for n in range(1, MAX_ATTEMPTS + 1):
        try:
            it = llm.interpret(rules, values, question, failures or None)
        except llm.LLMUnavailable as e:
            attempts.append({"attempt": n, "interpretation": None, "error": str(e), "checks": []})
            return {**base, "status": "unproven", "reason": str(e), "llm_unavailable": True}
        att = {"attempt": n, "interpretation": it.model_dump(mode="json"), "restatement": None, "sql": None, "checks": []}
        attempts.append(att)
        if it.cannot_answer:
            att["error"] = it.cannot_answer
            return {**base, "status": "unproven", "reason": f"I couldn't find a proven answer: {it.cannot_answer}"}
        try:
            comp = compile_interpretation(rules, it, values)
        except CompileError as e:
            att["checks"] = [{"name": "compiles", "passed": False, "detail": str(e)}]
            failures = [f"compiles: {e}"]
            continue
        att["restatement"], att["sql"] = comp.restatement, comp.sql
        res = verify_sql(db, rules, comp.sql, comp.metric)
        att["checks"] = res.checks
        if res.passed:
            return {**base, "status": "proven", "restatement": comp.restatement, "sql": comp.sql,
                    "checks": res.checks, "rows": res.rows, "columns": res.columns, "reason": None}
        failures = res.failures()
    reasons = "; ".join(failures)
    return {**base, "status": "unproven",
            "reason": f"I couldn't find a proven answer after {MAX_ATTEMPTS} attempts. Last failures: {reasons}"}
