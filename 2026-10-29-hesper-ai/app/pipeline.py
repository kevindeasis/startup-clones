"""The investigation pipeline: forensics -> extract_facts -> timeline -> inconsistencies -> coverage -> risk_and_actions."""
from __future__ import annotations

import base64
import json
import logging
import time
import traceback

from . import db, forensics, llm
from . import models as M

log = logging.getLogger("claimsleuth.pipeline")
MAX_CHARS = 12000
STEPS = ["forensics", "extract_facts", "timeline", "inconsistencies", "coverage", "risk_and_actions"]


def build_blocks(task: str, schema_model, payload: dict, extra: list[dict] | None = None) -> list[dict]:
    schema = json.dumps(schema_model.model_json_schema())
    text = (f"{task}\n\nReturn JSON only (no prose, no code fences) matching this JSON schema:\n{schema}\n\n"
            f"INPUT_JSON:\n{json.dumps(payload)}")
    return [{"type": "text", "text": text}] + (extra or [])


def truncate(text: str) -> str:
    if len(text) <= MAX_CHARS:
        return text
    return text[:MAX_CHARS] + f"\n[... truncated: {len(text) - MAX_CHARS} more characters omitted ...]"


def run_llm_step(inv_id: str, step: str, task: str, schema_model, payload: dict, extra=None, log_extra: dict | None = None):
    t0 = time.time()
    result, usage = llm.complete_json_with_usage(llm.SYSTEM_PROMPT, build_blocks(task, schema_model, payload, extra), schema_model)
    out = result.model_dump()
    if log_extra:
        out = {**log_extra, "result": out}
    db.log_decision(inv_id, step, usage.model, usage.input_tokens, usage.output_tokens, int((time.time() - t0) * 1000), out)
    return result


def set_step(inv_id: str, step: str) -> None:
    db.execute("UPDATE investigations SET current_step=? WHERE id=?", (step, inv_id))


def start_investigation(claim_id: str) -> str:
    inv_id = db.new_id()
    db.execute("INSERT INTO investigations(id,claim_id,status,current_step,started_at) VALUES(?,?,?,?,?)",
               (inv_id, claim_id, "running", "queued", db.now()))
    db.set_claim_status(claim_id, "investigating")
    return inv_id


def run_investigation(inv_id: str, claim_id: str) -> None:
    try:
        report = _run(inv_id, claim_id)
        db.execute("UPDATE investigations SET status='done', current_step='done', finished_at=?, report_json=? WHERE id=?",
                   (db.now(), json.dumps(report, default=str), inv_id))
        db.set_claim_status(claim_id, "investigated")
    except Exception as e:  # noqa: BLE001
        log.error("investigation failed: %s", traceback.format_exc())
        db.execute("UPDATE investigations SET status='error', finished_at=?, error=? WHERE id=?", (db.now(), f"{type(e).__name__}: {e}", inv_id))
        db.set_claim_status(claim_id, "error")


def _run(inv_id: str, claim_id: str) -> dict:
    claim = db.get_claim(claim_id)
    docs = db.list_documents(claim_id, full_text=True)
    claim_meta = {k: claim[k] for k in ("claim_number", "line_of_business", "claimant_name", "loss_date", "description")}

    # 1. forensics (deterministic; recomputed from stored files against current loss date)
    set_step(inv_id, "forensics")
    t0 = time.time()
    all_flags: list[dict] = []
    for d in docs:
        try:
            data = open(d["storage_path"], "rb").read()
            flags = forensics.analyze(data, d["mime"], d["doc_type"], claim["loss_date"])
        except OSError:
            flags = d["forensics"]
        for f in flags:
            f["document_id"] = d["id"]
        d["forensics"] = flags
        db.execute("UPDATE documents SET forensics_json=? WHERE id=?", (json.dumps(flags), d["id"]))
        all_flags.extend(flags)
    db.log_decision(inv_id, "forensics", "deterministic (no LLM)", 0, 0, int((time.time() - t0) * 1000), {"flags": all_flags})

    # 2. extract_facts (one call per document)
    facts: dict[str, M.DocumentFacts] = {}
    for i, d in enumerate(docs, 1):
        set_step(inv_id, f"extract_facts ({i}/{len(docs)})")
        payload = {"document_id": d["id"], "filename": d["filename"], "doc_type": d["doc_type"],
                   "claimant_name": claim["claimant_name"], "text": truncate(d["extracted_text"] or "")}
        extra = None
        if d["mime"].startswith("image/"):
            raw = open(d["storage_path"], "rb").read()
            extra = [{"type": "image", "source": {"type": "base64", "media_type": d["mime"], "data": base64.b64encode(raw).decode()}}]
        task = ("Extract facts from this claim document (document_id and doc_type are in the input). Every date, amount and assertion "
                "must include a verbatim quote of at most 200 characters from the source.")
        facts[d["id"]] = run_llm_step(inv_id, "extract_facts", task, M.DocumentFacts, payload, extra, {"document_id": d["id"], "filename": d["filename"]})

    # 3. timeline
    set_step(inv_id, "timeline")
    payload = {"claim": claim_meta, "documents": [
        {"document_id": d["id"], "filename": d["filename"], "dates": [x.model_dump() for x in facts[d["id"]].dates]} for d in docs]}
    timeline = run_llm_step(inv_id, "timeline", "Build a chronological timeline from these dated events (sorted ascending). "
                            "List gaps or anomalies, e.g. documents dated before the loss.", M.Timeline, payload)

    # 4. inconsistencies
    set_step(inv_id, "inconsistencies")
    payload = {"claim": claim_meta, "documents": [
        {"document_id": d["id"], "filename": d["filename"], "doc_type": d["doc_type"],
         "assertions": [x.model_dump() for x in facts[d["id"]].assertions],
         "dates": [x.model_dump() for x in facts[d["id"]].dates],
         "amounts": [x.model_dump() for x in facts[d["id"]].amounts],
         "parties": [x.model_dump() for x in facts[d["id"]].parties]} for d in docs if d["doc_type"] != "policy"]}
    incs = run_llm_step(inv_id, "inconsistencies", "Find inconsistencies between documents (conflicting dates, amounts, causes, parties) "
                        "and corroborated facts. Each inconsistency must cite two conflicting verbatim quotes with document_ids "
                        "(use 'claim' for the claim record).", M.InconsistencyReport, payload)

    # 5. coverage
    set_step(inv_id, "coverage")
    policies = [d for d in docs if d["doc_type"] == "policy"]
    if policies:
        payload = {"policies": [{"document_id": d["id"], "text": truncate(d["extracted_text"] or "")} for d in policies],
                   "loss_description": claim["description"],
                   "fact_quotes": [a.quote for d in docs if d["doc_type"] != "policy" for a in facts[d["id"]].assertions]}
        coverage = run_llm_step(inv_id, "coverage", "Determine the coverage position for this loss using only the policy text. "
                                "Quote the relevant clauses verbatim.", M.CoveragePosition, payload)
    else:
        coverage = M.CoveragePosition(position="unclear", clauses=[], rationale="No policy document uploaded", open_questions=["Upload the policy to assess coverage."])
        db.log_decision(inv_id, "coverage", "skipped (no policy document)", 0, 0, 0, coverage.model_dump())

    # 6. risk and actions
    set_step(inv_id, "risk_and_actions")
    payload = {"forensics": all_flags, "inconsistencies": [i.model_dump() for i in incs.inconsistencies],
               "coverage": coverage.model_dump(), "timeline_anomalies": timeline.gaps_or_anomalies}
    risk = run_llm_step(inv_id, "risk_and_actions", "Assess overall risk (score 0-100, band low<25<=medium<50<=high<75<=critical), "
                        "give rationale items that each reference a finding, recommended actions, and an executive summary of at most 150 words.",
                        M.RiskAssessment, payload)
    risk.band = M.band_for(risk.score)  # keep band consistent with score

    names = {d["id"]: d["filename"] for d in docs}
    names["claim"] = "Claim record"
    return {
        "claim": claim,
        "generated_at": db.now(),
        "provider": llm.provider_name(),
        "documents": [{"id": d["id"], "filename": d["filename"], "doc_type": d["doc_type"], "page_count": d["page_count"],
                       "size_bytes": d["size_bytes"], "forensics": d["forensics"]} for d in docs],
        "document_names": names,
        "executive_summary": risk.executive_summary,
        "forensics": all_flags,
        "statement_analysis": [{"document_id": d["id"], "filename": d["filename"], "doc_type": d["doc_type"],
                                "facts": facts[d["id"]].model_dump()} for d in docs],
        "timeline": timeline.model_dump(),
        "inconsistencies": incs.inconsistencies and [i.model_dump() for i in incs.inconsistencies] or [],
        "corroborations": [c.model_dump() for c in incs.corroborations],
        "coverage": coverage.model_dump(),
        "risk": risk.model_dump(),
        "recommended_actions": [a.model_dump() for a in risk.recommended_actions],
        "decision_log": db.decision_log(inv_id),
    }
