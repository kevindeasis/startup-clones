"""Win: inquiry intake pipeline (extract -> screen -> conflict check -> draft reply -> engagement letter)."""
import json

from . import agents, conflicts, db, letters, llm
from .agents import AppError

LITIGATION_WORDS = ("litigation", "lawsuit")


def screen(ex: dict) -> tuple[str, list[str]]:
    """Deterministic rules from firm_rules. The LLM never decides this."""
    rules = db.q("SELECT * FROM firm_rules")
    accept_areas = {r["value"] for r in rules if r["rule_type"] == "accept_area"}
    decline_areas = {r["value"] for r in rules if r["rule_type"] == "decline_area"}
    accept_j = {r["value"] for r in rules if r["rule_type"] == "accept_jurisdiction"}
    min_value = max([int(r["value"]) for r in rules if r["rule_type"] == "min_value"] or [0])
    area, jur, val = ex["practice_area"], ex["jurisdiction"], ex["estimated_value_usd"]
    reasons, decision = [], "accept"

    def worse(new):
        nonlocal decision
        order = {"accept": 0, "needs_lawyer": 1, "decline": 2}
        # decline wins over needs_lawyer; needs_lawyer wins over accept
        decision = new if order[new] > order[decision] else decision

    if area in decline_areas:
        reasons.append(f"Rule decline_area: the firm does not handle {area} matters")
        worse("decline")
    elif area not in accept_areas:
        reasons.append(f"Rule accept_area: practice area '{area}' is not in the accepted list ({', '.join(sorted(accept_areas))}); a lawyer must decide")
        worse("needs_lawyer")
    if jur == "unknown":
        reasons.append("Rule accept_jurisdiction: jurisdiction is unknown; a lawyer must confirm")
        worse("needs_lawyer")
    elif jur not in accept_j:
        reasons.append(f"Rule accept_jurisdiction: {jur} is outside the firm's states ({', '.join(sorted(accept_j))})")
        worse("decline")
    is_lit = area == "litigation" or any(w in ex["matter_type"].lower() for w in LITIGATION_WORDS)
    if is_lit and min_value:
        if val is not None and val < min_value:
            reasons.append(f"Rule min_value: estimated value ${val:,} is below the ${min_value:,} litigation minimum")
            worse("decline")
        elif val is None:
            reasons.append("Rule min_value: litigation matter with no stated value; a lawyer must confirm the amount")
            worse("needs_lawyer")
    if not reasons:
        reasons.append(f"Within accepted practice area ({area}) and jurisdiction ({jur})")
    return decision, reasons


def consult_times() -> list[str]:
    d, days = db.today(), []
    while len(days) < 3:
        d = db.add_days(d, 1)
        if d.weekday() < 5:
            days.append(d)
    return [f"{days[0].strftime('%A, %B %d')} at 10:00 AM ET", f"{days[2].strftime('%A, %B %d')} at 3:00 PM ET"]


def run_intake(inquiry_id: int) -> dict:
    inq = db.q1("SELECT * FROM inquiries WHERE id=?", (inquiry_id,))
    if not inq:
        raise AppError("inquiry not found", 404)
    db.run("DELETE FROM approvals WHERE inquiry_id=? AND status='pending'", (inquiry_id,))  # re-run replaces
    steps, created = [], []

    ex = llm.extract_inquiry(inq)
    exd = ex.model_dump()
    steps.append({"name": "Extract", "result": exd})

    decision, reasons = screen(exd)
    steps.append({"name": "Screen", "result": {"decision": decision, "reasons": reasons}})

    parties = [p for p in exd["parties"]]
    cf = conflicts.check_parties(parties)
    cf["summary"] = [conflicts.describe(m) for m in cf["matches"]]
    if cf["conflict"] or cf["possible"]:
        kind = "Conflict" if cf["conflict"] else "Possible conflict"
        reasons = reasons + [f"{kind} check: " + "; ".join(conflicts.describe(m) for m in cf["matches"] if m["conflicting"])]
        decision = "needs_lawyer" if decision == "accept" or cf["conflict"] else decision
    steps.append({"name": "Conflict check", "result": cf})

    times = consult_times()
    reply = llm.draft_reply(inq, exd, decision, reasons, times)
    rid = agents.create_approval("reply_email", f"Reply to {inq['name']} ({decision})", reply.body, reply.subject, inq["email"], reply.rationale,
                                 {"decision": decision}, inquiry_id=inquiry_id)
    created.append(rid)
    steps.append({"name": "Draft reply", "result": {"approval_id": rid, "subject": reply.subject, "body": reply.body, "times": times if decision == "accept" else []}})

    if decision == "accept":
        terms = llm.draft_engagement_terms(inq, exd).model_dump()
        client_party = next((p["name"] for p in parties if p["role"] == "client"), inq["name"])
        client_name = client_party if exd["client_type"] == "company" else (inq["name"] or client_party)
        adverse = [p["name"] for p in parties if p["role"] == "adverse"]
        title = f"{client_name} - {exd['matter_type']}"
        lawyer = "Elena Vale, Partner"
        client = {"name": client_name, "type": exd["client_type"], "email": inq["email"], "phone": inq["phone"]}
        md = letters.render_letter_md(db.firm(), client, {"title": title, "lawyer_name": lawyer}, terms)
        lid = agents.create_approval(
            "engagement_letter", f"Engagement letter: {title}", md, f"Engagement letter: {title}", inq["email"],
            "Matter accepted by firm rules and clear of conflicts; LLM filled scope, fees, retainer and exclusions into the firm's fixed template.",
            {"client": client, "terms": terms, "matter": {"title": title, "practice_area": exd["practice_area"], "matter_type": exd["matter_type"],
                                                           "summary": exd["summary"], "adverse": adverse, "lawyer_name": lawyer}},
            inquiry_id=inquiry_id)
        created.append(lid)
        steps.append({"name": "Draft engagement letter", "result": {"approval_id": lid, "terms": terms}})

    status = {"accept": "accepted", "decline": "declined", "needs_lawyer": "needs_lawyer"}[decision]
    result = {"decision": decision, "reasons": reasons, "steps": steps, "approval_ids": created}
    db.run("UPDATE inquiries SET status=?, pipeline_json=? WHERE id=?", (status, json.dumps(result), inquiry_id))
    return result
