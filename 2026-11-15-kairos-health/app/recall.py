"""Outbound recall: find overdue patients, write outreach, handle simulated replies."""
import json
from datetime import date, datetime, timedelta

from . import agent, config, scheduling as sch


def _cutoff(today: date, months: int) -> date:
    y, m = today.year, today.month - months
    while m <= 0:
        m += 12
        y -= 1
    day = min(today.day, 28)
    return date(y, m, day)


def overdue_patients(conn, today: date | None = None, months: int | None = None) -> list[dict]:
    today = today or config.today()
    months = months or config.recall_months()
    cutoff = _cutoff(today, months)
    rows = conn.execute(
        """SELECT p.*, (SELECT MAX(start_at) FROM appointments a WHERE a.patient_id=p.id AND a.status='completed'
                         AND a.type IN ('hygiene','exam')) AS last_visit,
                  (SELECT name FROM providers WHERE id=p.preferred_hygienist_id) AS hygienist_name
           FROM patients p
           WHERE last_visit IS NOT NULL AND last_visit < ?
             AND NOT EXISTS (SELECT 1 FROM appointments f WHERE f.patient_id=p.id AND f.status='scheduled' AND f.start_at >= ?)
           ORDER BY last_visit""",
        (cutoff.isoformat() + "T00:00", sch.fmt(datetime.combine(today, datetime.min.time()))),
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        lv = date.fromisoformat(d["last_visit"][:10])
        d["last_visit_date"] = lv.isoformat()
        d["months_since"] = max(1, round((today - lv).days / 30.44))
        d["outreach_status"] = (conn.execute("SELECT status FROM recall_outreach WHERE patient_id=? ORDER BY id DESC LIMIT 1", (d["id"],)).fetchone() or [None])[0]
        out.append(d)
    return out


def counters(conn) -> dict:
    q = lambda sql: conn.execute(sql).fetchone()[0]
    return {
        "overdue": len(overdue_patients(conn)),
        "sent": q("SELECT COUNT(*) FROM recall_outreach"),
        "replies": q("SELECT COUNT(*) FROM recall_outreach WHERE status<>'sent'"),
        "booked": q("SELECT COUNT(*) FROM recall_outreach WHERE status='booked'"),
    }


def _proposed_slots(conn, patient: dict, index: int) -> list[dict]:
    d1 = config.today() + timedelta(days=1)
    d2 = config.today() + timedelta(days=14)
    cands = sch.open_slots(conn, d1, d2, "hygiene", patient.get("preferred_hygienist_id"))
    if len(cands) < 2:
        cands = sch.open_slots(conn, d1, d2, "hygiene")
    if not cands:
        return []
    n = len(cands)
    a = cands[(index * 5) % n]
    b = next((c for c in cands[((index * 5) + max(1, n // 3)) % n:] + cands if c["start_at"][:10] != a["start_at"][:10]), None)
    return [a] + ([b] if b else [])


def _template(patient: dict, slots: list[dict]) -> str:
    first = patient["first_name"]
    msg = f"Hi {first}, this is Maple Street Dental. It's been about {patient['months_since']} months since your last visit"
    if patient.get("hygienist_name"):
        msg += f" with {patient['hygienist_name']}"
    msg += ". "
    if slots:
        opts = " or ".join(f"({i}) {s['label']}" for i, s in enumerate(slots, 1))
        msg += f"We have openings {opts} for your cleaning. Reply with 1 or 2 (or tell us what works) and we'll book it. "
    else:
        msg += "Reply with a day that works for you and we'll find a cleaning slot. "
    return msg + "Reply STOP to opt out."


def run_recall(conn) -> dict:
    created = []
    patients = overdue_patients(conn)
    for i, p in enumerate(patients):
        if p["outreach_status"] in ("sent", "replied"):
            continue
        slots = _proposed_slots(conn, p, i)
        message = agent.compose_outreach(p, slots, _template(p, slots))
        conv_id = agent.create_conversation(conn, "recall", patient_id=p["id"], greeting=message, state={"mode": "recall", "step": "await_reply", "slots": slots, "patient_id": p["id"], "first_name": p["first_name"]})["id"]
        cur = conn.execute(
            "INSERT INTO recall_outreach(patient_id,conversation_id,message,proposed_slots_json,sent_at,status) VALUES (?,?,?,?,?,'sent')",
            (p["id"], conv_id, message, json.dumps(slots), config.now().isoformat(timespec="seconds")))
        conn.commit()
        created.append({"id": cur.lastrowid, "patient_id": p["id"], "patient": f"{p['first_name']} {p['last_name']}", "message": message})
    return {"created": len(created), "skipped": len(patients) - len(created), "outreach": created, "counters": counters(conn)}


def list_outreach(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT o.*, p.first_name, p.last_name, p.phone FROM recall_outreach o JOIN patients p ON p.id=o.patient_id ORDER BY o.id"""
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["proposed_slots"] = json.loads(d.pop("proposed_slots_json") or "[]")
        d["patient"] = f"{d['first_name']} {d['last_name']}"
        out.append(d)
    return out


def reply(conn, outreach_id: int, text: str) -> dict:
    o = conn.execute("SELECT * FROM recall_outreach WHERE id=?", (outreach_id,)).fetchone()
    if not o:
        raise KeyError("outreach not found")
    res = agent.run_turn(conn, o["conversation_id"], text)
    derived = {"booked": "booked", "declined": "declined", "snoozed": "snoozed"}.get(res.get("outcome"), "replied")
    status = o["status"]
    if derived != "replied" or status in ("sent", "replied"):
        status = derived
    conn.execute("UPDATE recall_outreach SET status=? WHERE id=?", (status, outreach_id))
    conn.commit()
    res["status"] = status
    return res
