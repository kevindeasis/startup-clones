"""Shared system-prompt preamble and rejection-feedback lookup."""
import json

from . import db

PREAMBLE = """You are the operations assistant of {name}, a small law firm ({areas}).
You draft administrative work for lawyers to approve: nothing you write is sent until a lawyer approves it.
Rules you always follow:
- Never give legal advice and never promise or predict outcomes.
- Never threaten legal action, in any tone or situation.
- Write in plain, professional English. Keep every email under 180 words.
- Use the firm profile below. Do not invent facts, fees, deadlines or names that are not in the input.
Firm profile: address {address}; phone {phone}; email {email}; consult policy: {consult_policy}
Bar referral line (use verbatim when declining): {bar_referral_line}
"""


def rejection_notes(matter_id: int | None = None, inquiry_id: int | None = None) -> list[str]:
    ids_m, ids_i = set(), set()
    if matter_id:
        ids_m.add(matter_id)
        m = db.q1("SELECT inquiry_id FROM matters WHERE id=?", (matter_id,))
        if m and m["inquiry_id"]:
            ids_i.add(m["inquiry_id"])
    if inquiry_id:
        ids_i.add(inquiry_id)
    notes = []
    for a in db.q("SELECT matter_id,inquiry_id,type,reject_reason FROM approvals WHERE status='rejected' AND reject_reason IS NOT NULL ORDER BY id"):
        if (a["matter_id"] in ids_m) or (a["inquiry_id"] in ids_i):
            notes.append(f"{a['type']}: {a['reject_reason']}")
    return notes


def system_prompt(task: str, matter_id=None, inquiry_id=None) -> str:
    f = db.firm()
    s = PREAMBLE.format(
        name=f.get("name"), areas=", ".join(f.get("practice_areas", [])), address=f.get("address"),
        phone=f.get("phone"), email=f.get("email"), consult_policy=f.get("consult_policy"),
        bar_referral_line=f.get("bar_referral_line"),
    )
    s += f"\nYour current task: {task}\n"
    notes = rejection_notes(matter_id, inquiry_id)
    if notes:
        s += "\nThe lawyer previously REJECTED earlier drafts for this matter with these reasons. Follow them as instructions:\n"
        s += "\n".join(f"- {n}" for n in notes) + "\n"
    return s


def user_prompt(ctx: dict) -> str:
    return "Input (JSON):\n" + json.dumps(ctx, indent=2, default=str)
