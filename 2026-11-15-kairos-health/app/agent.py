"""Conversation orchestration: persistence, live (Claude) vs mock mode, outreach composition."""
import json

from . import config, llm, mock_agent
from . import scheduling as sch
from .tools import TOOLS, execute_tool, practice_info

GREETING = "Thank you for calling Maple Street Dental, this is the AI front desk. How can I help you today?"
SYNTHETIC = "[system]"


def create_conversation(conn, channel: str, patient_id=None, greeting: str | None = None, state: dict | None = None) -> dict:
    greeting = greeting or GREETING
    first = "[system] call connected" if channel == "inbound" else "[system] outbound recall text sent to patient"
    msgs = [{"role": "user", "content": first}, {"role": "assistant", "content": greeting}]
    st = state or {"mode": channel if channel == "recall" else "inbound", "step": "start"}
    cur = conn.execute(
        "INSERT INTO conversations(channel,patient_id,started_at,mode,messages_json,state_json) VALUES (?,?,?,?,?,?)",
        (channel, patient_id, config.now().isoformat(timespec="seconds"), config.mode(), json.dumps(msgs), json.dumps(st)))
    conn.commit()
    return {"id": cur.lastrowid, "greeting": greeting}


def build_system(conn, conv: dict, state: dict) -> str:
    p = dict(conn.execute("SELECT * FROM practice WHERE id=1").fetchone())
    now = config.now()
    profile = (f"Practice: {p['name']}, {p['address']}, phone {p['phone']}.\nHours: {practice_info(conn, 'hours')['answer']}\n"
               f"Parking: {p['parking']}\nWhat to bring: {p['what_to_bring']}\nAccepted insurers: {', '.join(json.loads(p['accepted_payers_json']))}\n"
               f"FAQ: {p['faq_json']}")
    rules = """HARD RULES
- Identify the patient with full name + date of birth (find_patient) before any booking, reschedule or cancel. If unknown, offer to register them (name, DOB, phone) with create_patient.
- Find the reason for the visit (cleaning/hygiene, exam, emergency/toothache, follow-up), call get_availability, and offer AT MOST 3 concrete slots.
- Confirm the chosen slot back to the caller BEFORE calling book_appointment / reschedule_appointment / cancel_appointment. After booking, read back date, time, provider and chair.
- Never give clinical advice. Never promise exact costs; explain insurance results in plain language with the caveat that they are estimates.
- If a booking tool returns an error (e.g. slot taken), apologise briefly and offer other slots.
- If you cannot help (billing dispute, clinical question, complaint, you are stuck), call take_message with the caller's name and phone.
- When the request is resolved call end_call with the outcome (booked | rescheduled | cancelled | insurance_verified | faq | message_taken | abandoned; for recall texts also declined | snoozed).
- Keep replies to 1-3 short sentences, in a spoken, friendly style. This is a fictional demo practice."""
    if conv["channel"] == "recall":
        pat = conn.execute("SELECT * FROM patients WHERE id=?", (conv["patient_id"],)).fetchone()
        channel = (f"CHANNEL: outbound recall SMS thread. The patient is {pat['first_name']} {pat['last_name']} (patient_id {pat['id']}), "
                   f"already identified, so skip identity checks. You already texted them the first message. Proposed slots: {json.dumps(state.get('slots', []))}. "
                   "If they agree to a slot, confirm and book it with book_appointment (hygiene) using the slot's provider_id and operatory_id, then end_call(booked). "
                   "If they decline or opt out, end_call(declined). If they ask for later, end_call(snoozed). Keep texts short.")
    else:
        channel = "CHANNEL: inbound phone call (simulated as chat). Greet, then help."
    return f"You are the AI front desk receptionist.\nNow: {now.strftime('%A %Y-%m-%d %H:%M')} (practice local time).\n{channel}\n\n{profile}\n\n{rules}"


def load(conn, conv_id: int) -> dict:
    r = conn.execute("SELECT * FROM conversations WHERE id=?", (conv_id,)).fetchone()
    if not r:
        raise KeyError("conversation not found")
    return dict(r)


def run_turn(conn, conv_id: int, text: str, client=None) -> dict:
    conv = load(conn, conv_id)
    messages = json.loads(conv["messages_json"])
    log = json.loads(conv["tool_log_json"])
    state = json.loads(conv["state_json"] or "{}")
    ctx = {"conversation_id": conv_id, "channel": conv["channel"]}
    calls = []

    def execute(name, args):
        return execute_tool(conn, name, args, ctx)

    if conv["mode"] == "mock":
        def call(name, args):
            res = execute(name, args)
            calls.append({"name": name, "input": args, "result": res})
            return res
        reply = mock_agent.respond(call, state, text)
        messages += [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]
    else:
        work = messages + [{"role": "user", "content": text}]
        try:
            reply, calls = llm.run_tool_loop(client or llm.get_client(), build_system(conn, conv, state), TOOLS, work, execute)
        except Exception as e:  # network / API errors: keep the call alive, do not persist the half turn
            return {"reply": "I'm sorry, I'm having trouble on my end. Could you say that again?", "tool_calls": [],
                    "outcome": conv["outcome"], "error": f"{type(e).__name__}: {e}"}
        messages = work
        reply = reply or "Sorry, could you repeat that?"
    turn = sum(1 for m in messages if m["role"] == "user" and isinstance(m["content"], str) and not m["content"].startswith(SYNTHETIC))
    log += [dict(c, turn=turn) for c in calls]
    conn.execute("UPDATE conversations SET messages_json=?, tool_log_json=?, state_json=? WHERE id=?",
                 (json.dumps(messages), json.dumps(log), json.dumps(state), conv_id))
    conn.commit()
    outcome = conn.execute("SELECT outcome FROM conversations WHERE id=?", (conv_id,)).fetchone()[0]
    return {"reply": reply, "tool_calls": calls, "outcome": outcome}


def end_conversation(conn, conv_id: int) -> dict:
    conv = load(conn, conv_id)
    if not conv["outcome"]:
        conn.execute("UPDATE conversations SET outcome='abandoned', ended_at=? WHERE id=?", (config.now().isoformat(timespec="seconds"), conv_id))
        conn.commit()
    return {"id": conv_id, "outcome": load(conn, conv_id)["outcome"]}


def transcript(conv: dict) -> list[dict]:
    """Human-readable turns from the stored message list (hides synthetic + tool blocks)."""
    out = []
    for m in json.loads(conv["messages_json"]):
        c = m["content"]
        if isinstance(c, str):
            if c.startswith(SYNTHETIC):
                continue
            out.append({"role": m["role"], "text": c})
        elif m["role"] == "assistant":
            t = " ".join(b.get("text", "") for b in c if b.get("type") == "text").strip()
            if t:
                out.append({"role": "assistant", "text": t})
    return out


def compose_outreach(patient: dict, slots: list[dict], template: str) -> str:
    if config.is_mock() or not slots:
        return template
    try:
        slot_txt = "; ".join(s["label"] for s in slots)
        prompt = (f"Write one SMS (max 320 chars) from Maple Street Dental to {patient['first_name']}, who last visited about {patient['months_since']} months ago"
                  f"{' with ' + patient['hygienist_name'] if patient.get('hygienist_name') else ''}. Offer exactly these 2 slots for a cleaning: {slot_txt}. "
                  "Ask them to reply with their pick and end with: Reply STOP to opt out. No emojis. Return only the SMS text.")
        return llm.complete_text(prompt) or template
    except Exception:
        return template
