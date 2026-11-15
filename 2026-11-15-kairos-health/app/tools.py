"""Anthropic tool definitions (strict) and their SQLite-backed executors."""
import json
from datetime import date, datetime, timedelta

from . import config, insurance, scheduling as sch
from .scheduling import BookingError

OUTCOMES = ["booked", "rescheduled", "cancelled", "insurance_verified", "faq", "message_taken", "abandoned", "declined", "snoozed"]
TOPICS = ["hours", "address", "phone", "parking", "insurance", "what_to_bring", "faq"]


def _tool(name, description, props, required):
    return {
        "name": name, "description": description, "strict": True,
        "input_schema": {"type": "object", "properties": props, "required": required, "additionalProperties": False},
    }


_S = {"type": "string"}
_I = {"type": "integer"}
_TYPE = {"type": "string", "enum": sch.TYPES, "description": "Appointment type. hygiene=cleaning (60 min, hygienist); others 30 min with a dentist."}
_DT = {"type": "string", "description": "Local practice time as YYYY-MM-DDTHH:MM"}

TOOLS = [
    _tool("find_patient", "Look up an existing patient by full name and date of birth. Returns found=false if there is no match.",
          {"first_name": _S, "last_name": _S, "dob": {"type": "string", "description": "YYYY-MM-DD"}}, ["first_name", "last_name", "dob"]),
    _tool("create_patient", "Register a new patient. Only use after find_patient found nothing and the caller agreed to register.",
          {"first_name": _S, "last_name": _S, "dob": {"type": "string", "description": "YYYY-MM-DD"}, "phone": _S}, ["first_name", "last_name", "dob", "phone"]),
    _tool("get_patient_appointments", "List a patient's upcoming scheduled appointments.", {"patient_id": _I}, ["patient_id"]),
    _tool("get_availability", "Find up to 10 open slots (chair and provider both free) between two dates. Offer the caller at most 3.",
          {"date_from": {"type": "string", "description": "YYYY-MM-DD"}, "date_to": {"type": "string", "description": "YYYY-MM-DD"},
           "appointment_type": _TYPE, "provider_id": {"type": "integer", "description": "Optional: restrict to one provider"}},
          ["date_from", "date_to", "appointment_type"]),
    _tool("book_appointment", "Book an appointment into a slot returned by get_availability. Only call after the caller confirmed the slot.",
          {"patient_id": _I, "start_at": _DT, "appointment_type": _TYPE, "provider_id": _I, "operatory_id": _I},
          ["patient_id", "start_at", "appointment_type", "provider_id", "operatory_id"]),
    _tool("reschedule_appointment", "Move an existing scheduled appointment to a new start time (keeps type; picks a free chair/provider).",
          {"appointment_id": _I, "new_start_at": _DT}, ["appointment_id", "new_start_at"]),
    _tool("cancel_appointment", "Cancel a scheduled appointment after the caller confirmed.", {"appointment_id": _I}, ["appointment_id"]),
    _tool("verify_insurance", "Verify dental insurance eligibility and benefits with the payer directory. patient_id is optional.",
          {"patient_id": _I, "payer": _S, "member_id": _S, "dob": {"type": "string", "description": "Subscriber DOB YYYY-MM-DD"}},
          ["payer", "member_id", "dob"]),
    _tool("get_practice_info", "Get practice information for an FAQ answer.", {"topic": {"type": "string", "enum": TOPICS}}, ["topic"]),
    _tool("take_message", "Leave a message for the human staff (billing disputes, clinical questions, complaints, anything you cannot resolve).",
          {"patient_name": _S, "phone": _S, "summary": _S}, ["patient_name", "phone", "summary"]),
    _tool("end_call", "Record how the conversation ended. Call this when the caller's request is resolved. For recall texts use declined or snoozed when the patient says no or later.",
          {"outcome": {"type": "string", "enum": OUTCOMES}, "summary": _S}, ["outcome", "summary"]),
]


def hours_text(hours: dict) -> str:
    names = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday", "fri": "Friday", "sat": "Saturday", "sun": "Sunday"}

    def t(s):
        return datetime.strptime(s, "%H:%M").strftime("%I:%M %p").lstrip("0")

    groups = []
    for k in sch.WEEKDAYS:
        h = hours.get(k)
        key = tuple(h) if h else None
        if groups and groups[-1][1] == key:
            groups[-1][0].append(k)
        else:
            groups.append(([k], key))
    parts = []
    for days, key in groups:
        label = names[days[0]] if len(days) == 1 else f"{names[days[0]]} to {names[days[-1]]}"
        parts.append(f"{label}: {t(key[0])} to {t(key[1])}" if key else f"{label}: closed")
    return "; ".join(parts)


def practice_info(conn, topic: str) -> dict:
    p = dict(conn.execute("SELECT * FROM practice WHERE id=1").fetchone())
    hours = json.loads(p["hours_json"])
    payers = json.loads(p["accepted_payers_json"])
    answers = {
        "hours": f"{p['name']} is open {hours_text(hours)}.",
        "address": f"We're at {p['address']}.",
        "phone": f"Our phone number is {p['phone']}.",
        "parking": p["parking"],
        "insurance": "We accept " + ", ".join(payers) + ". I can verify your benefits if you give me your member ID.",
        "what_to_bring": p["what_to_bring"],
        "faq": json.loads(p["faq_json"]),
    }
    return {"topic": topic, "answer": answers[topic]}


def _patient_dict(conn, r) -> dict:
    plan = conn.execute("SELECT payer, member_id FROM insurance_plans WHERE patient_id=? ORDER BY id LIMIT 1", (r["id"],)).fetchone()
    hyg = conn.execute("SELECT name FROM providers WHERE id=?", (r["preferred_hygienist_id"],)).fetchone() if r["preferred_hygienist_id"] else None
    return {
        "found": True, "patient_id": r["id"], "first_name": r["first_name"], "last_name": r["last_name"], "phone": r["phone"],
        "preferred_hygienist_id": r["preferred_hygienist_id"], "preferred_hygienist": hyg["name"] if hyg else None,
        "insurance_on_file": {"payer": plan["payer"], "member_id": plan["member_id"]} if plan else None,
    }


def execute_tool(conn, name: str, args: dict, ctx: dict | None = None) -> dict:
    ctx = ctx or {}
    try:
        return _run(conn, name, args or {}, ctx)
    except BookingError as e:
        return {"ok": False, "error": str(e)}
    except (KeyError, TypeError, ValueError) as e:
        return {"ok": False, "error": f"Bad arguments for {name}: {e}"}


def _run(conn, name, a, ctx):
    if name == "find_patient":
        r = conn.execute(
            "SELECT * FROM patients WHERE lower(first_name)=lower(?) AND lower(last_name)=lower(?) AND dob=?",
            (a["first_name"].strip(), a["last_name"].strip(), a["dob"].strip()),
        ).fetchone()
        return _patient_dict(conn, r) if r else {"found": False}
    if name == "create_patient":
        try:
            datetime.strptime(a["dob"], "%Y-%m-%d")
        except ValueError:
            return {"ok": False, "error": "dob must be YYYY-MM-DD"}
        cur = conn.execute(
            "INSERT INTO patients(first_name,last_name,dob,phone,created_at) VALUES (?,?,?,?,?)",
            (a["first_name"].strip(), a["last_name"].strip(), a["dob"], a["phone"].strip(), config.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        return {"ok": True, "patient_id": cur.lastrowid, "first_name": a["first_name"].strip(), "last_name": a["last_name"].strip()}
    if name == "get_patient_appointments":
        rows = conn.execute(
            "SELECT id FROM appointments WHERE patient_id=? AND status='scheduled' AND start_at >= ? ORDER BY start_at",
            (a["patient_id"], sch.fmt(config.now())),
        ).fetchall()
        appts = []
        for r in rows:
            d = sch.appointment_detail(conn, r["id"])
            appts.append({k: d[k] for k in ("id", "start_at", "end_at", "label", "type", "provider_name", "operatory_name", "source")})
        return {"appointments": appts}
    if name == "get_availability":
        t = a["appointment_type"]
        d1 = date.fromisoformat(a["date_from"])
        d2 = date.fromisoformat(a["date_to"])
        if d2 < d1 or (d2 - d1).days > 60:
            return {"ok": False, "error": "date range must be 0-60 days"}
        slots = sch.open_slots(conn, d1, d2, t, a.get("provider_id"))
        return {"slots": sch.spread(slots, 10), "total_open": len(slots)}
    if name == "book_appointment":
        source = "ai_recall" if ctx.get("channel") == "recall" else "ai_inbound"
        d = sch.create_appointment(conn, a["patient_id"], a["provider_id"], a["operatory_id"], a["start_at"], a["appointment_type"], source)
        return {"ok": True, "booked": True, "appointment_id": d["id"], "label": d["label"], "start_at": d["start_at"],
                "type": d["type"], "provider_name": d["provider_name"], "operatory_name": d["operatory_name"]}
    if name == "reschedule_appointment":
        d = sch.reschedule_appointment(conn, a["appointment_id"], a["new_start_at"])
        return {"ok": True, "rescheduled": True, "appointment_id": d["id"], "label": d["label"], "start_at": d["start_at"],
                "type": d["type"], "provider_name": d["provider_name"], "operatory_name": d["operatory_name"]}
    if name == "cancel_appointment":
        d = sch.cancel_appointment(conn, a["appointment_id"])
        return {"ok": True, "cancelled": True, "appointment_id": d["id"], "label": d["label"], "type": d["type"]}
    if name == "verify_insurance":
        return insurance.verify(conn, a["payer"], a["member_id"], a["dob"], a.get("patient_id"), source="ai")
    if name == "get_practice_info":
        return practice_info(conn, a["topic"])
    if name == "take_message":
        cur = conn.execute(
            "INSERT INTO messages_taken(conversation_id,patient_name,phone,summary,created_at) VALUES (?,?,?,?,?)",
            (ctx.get("conversation_id"), a["patient_name"], a["phone"], a["summary"], config.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        return {"ok": True, "message_id": cur.lastrowid}
    if name == "end_call":
        if a["outcome"] not in OUTCOMES:
            return {"ok": False, "error": "unknown outcome"}
        if ctx.get("conversation_id"):
            conn.execute("UPDATE conversations SET outcome=?, ended_at=? WHERE id=?",
                         (a["outcome"], config.now().isoformat(timespec="seconds"), ctx["conversation_id"]))
            conn.commit()
        return {"ok": True, "outcome": a["outcome"]}
    return {"ok": False, "error": f"unknown tool {name}"}
