"""Schedule logic: hours, availability, booking (with double-booking guard), grid and utilisation."""
import json
import sqlite3
from datetime import date, datetime, time, timedelta

from . import config

FMT = "%Y-%m-%dT%H:%M"
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
SLOT_MIN = 30
DURATIONS = {"hygiene": 60, "exam": 30, "emergency": 30, "followup": 30, "consult": 30}
ROLE_FOR = {"hygiene": "hygienist", "exam": "dentist", "emergency": "dentist", "followup": "dentist", "consult": "dentist"}
TYPES = list(DURATIONS)


class BookingError(Exception):
    pass


def parse_dt(s: str) -> datetime:
    try:
        return datetime.strptime(str(s).strip().replace(" ", "T")[:16], FMT)
    except ValueError:
        raise BookingError("Date/time must look like YYYY-MM-DDTHH:MM (local practice time).")


def fmt(dt: datetime) -> str:
    return dt.strftime(FMT)


def time_label(dt: datetime) -> str:
    return dt.strftime("%I:%M %p").lstrip("0")


def human(dt: datetime) -> str:
    return f"{dt.strftime('%A, %B')} {dt.day} at {time_label(dt)}"


def hours_for(conn, d: date):
    row = conn.execute("SELECT hours_json FROM practice WHERE id=1").fetchone()
    if not row:
        return None
    h = json.loads(row[0]).get(WEEKDAYS[d.weekday()])
    if not h:
        return None
    return (datetime.combine(d, time.fromisoformat(h[0])), datetime.combine(d, time.fromisoformat(h[1])))


def appointment_detail(conn, appt_id: int) -> dict | None:
    r = conn.execute(
        """SELECT a.*, p.first_name, p.last_name, pr.name AS provider_name, pr.color AS provider_color,
                  o.name AS operatory_name
           FROM appointments a JOIN patients p ON p.id=a.patient_id
           JOIN providers pr ON pr.id=a.provider_id JOIN operatories o ON o.id=a.operatory_id
           WHERE a.id=?""",
        (appt_id,),
    ).fetchone()
    if not r:
        return None
    d = dict(r)
    d["patient_name"] = f"{d['first_name']} {d['last_name']}"
    d["label"] = human(parse_dt(d["start_at"]))
    return d


def find_conflict(conn, start: datetime, end: datetime, provider_id, operatory_id, patient_id=None, exclude_id=None):
    rows = conn.execute(
        """SELECT provider_id, operatory_id, patient_id FROM appointments
           WHERE status='scheduled' AND start_at < ? AND end_at > ? AND id <> ?""",
        (fmt(end), fmt(start), exclude_id or -1),
    ).fetchall()
    for r in rows:
        if r["operatory_id"] == operatory_id:
            return "That chair is already booked at that time."
        if r["provider_id"] == provider_id:
            return "That provider is already booked at that time."
        if patient_id is not None and r["patient_id"] == patient_id:
            return "The patient already has an appointment overlapping that time."
    return None


def _validate_window(conn, start: datetime, end: datetime, allow_past: bool):
    h = hours_for(conn, start.date())
    if not h:
        raise BookingError("The practice is closed that day.")
    if start < h[0] or end > h[1]:
        raise BookingError(f"That time is outside practice hours ({time_label(h[0])} to {time_label(h[1])}).")
    if start.minute % SLOT_MIN:
        raise BookingError("Appointments start on the hour or half hour.")
    if not allow_past and start <= config.now():
        raise BookingError("That time is in the past.")


def create_appointment(conn, patient_id, provider_id, operatory_id, start_at, type_, source="staff", allow_past=False, status="scheduled") -> dict:
    if type_ not in DURATIONS:
        raise BookingError(f"Unknown appointment type '{type_}'.")
    start = parse_dt(start_at)
    end = start + timedelta(minutes=DURATIONS[type_])
    if not conn.execute("SELECT 1 FROM patients WHERE id=?", (patient_id,)).fetchone():
        raise BookingError("Unknown patient.")
    prov = conn.execute("SELECT role FROM providers WHERE id=?", (provider_id,)).fetchone()
    if not prov:
        raise BookingError("Unknown provider.")
    if prov["role"] != ROLE_FOR[type_]:
        raise BookingError(f"A {type_} visit needs a {ROLE_FOR[type_]}.")
    if not conn.execute("SELECT 1 FROM operatories WHERE id=?", (operatory_id,)).fetchone():
        raise BookingError("Unknown chair.")
    if status == "scheduled":
        _validate_window(conn, start, end, allow_past)
        msg = find_conflict(conn, start, end, provider_id, operatory_id, patient_id)
        if msg:
            raise BookingError(msg)
    try:
        cur = conn.execute(
            """INSERT INTO appointments(patient_id,provider_id,operatory_id,start_at,end_at,type,status,source,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (patient_id, provider_id, operatory_id, fmt(start), fmt(end), type_, status, source, config.now().isoformat(timespec="seconds")),
        )
    except sqlite3.IntegrityError as e:
        raise BookingError("That slot was just taken (" + str(e) + ").")
    conn.commit()
    return appointment_detail(conn, cur.lastrowid)


def reschedule_appointment(conn, appointment_id: int, new_start_at: str) -> dict:
    appt = conn.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)).fetchone()
    if not appt:
        raise BookingError("Appointment not found.")
    if appt["status"] != "scheduled":
        raise BookingError("Only scheduled appointments can be rescheduled.")
    start = parse_dt(new_start_at)
    end = start + timedelta(minutes=DURATIONS[appt["type"]])
    _validate_window(conn, start, end, False)
    role = ROLE_FOR[appt["type"]]
    provs = [appt["provider_id"]] + [r["id"] for r in conn.execute("SELECT id FROM providers WHERE role=? ORDER BY id", (role,)) if r["id"] != appt["provider_id"]]
    ops = [appt["operatory_id"]] + [r["id"] for r in conn.execute("SELECT id FROM operatories ORDER BY id") if r["id"] != appt["operatory_id"]]
    last_msg = "No chair and provider are free then."
    for pid in provs:
        for oid in ops:
            msg = find_conflict(conn, start, end, pid, oid, appt["patient_id"], exclude_id=appointment_id)
            if msg:
                last_msg = msg
                continue
            try:
                conn.execute("UPDATE appointments SET start_at=?, end_at=?, provider_id=?, operatory_id=? WHERE id=?",
                             (fmt(start), fmt(end), pid, oid, appointment_id))
            except sqlite3.IntegrityError as e:
                last_msg = str(e)
                continue
            conn.commit()
            return appointment_detail(conn, appointment_id)
    raise BookingError(last_msg)


def cancel_appointment(conn, appointment_id: int) -> dict:
    appt = conn.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)).fetchone()
    if not appt:
        raise BookingError("Appointment not found.")
    if appt["status"] != "scheduled":
        raise BookingError("That appointment is not scheduled, so it cannot be cancelled.")
    conn.execute("UPDATE appointments SET status='cancelled' WHERE id=?", (appointment_id,))
    conn.commit()
    return appointment_detail(conn, appointment_id)


def open_slots(conn, date_from: date, date_to: date, type_: str, provider_id=None, now: datetime | None = None) -> list[dict]:
    """All open slots (a free chair AND a free provider of the right role), chronological."""
    now = now or config.now()
    dur = timedelta(minutes=DURATIONS[type_])
    provs = [dict(r) for r in conn.execute("SELECT * FROM providers WHERE role=? ORDER BY id", (ROLE_FOR[type_],))]
    if provider_id is not None:
        provs = [p for p in provs if p["id"] == provider_id]
    ops = [dict(r) for r in conn.execute("SELECT * FROM operatories ORDER BY id")]
    out = []
    d = date_from
    while d <= date_to:
        h = hours_for(conn, d)
        if h and provs:
            booked = conn.execute(
                "SELECT start_at,end_at,provider_id,operatory_id FROM appointments WHERE status='scheduled' AND start_at < ? AND end_at > ?",
                (fmt(h[1]), fmt(h[0])),
            ).fetchall()
            s = h[0]
            while s + dur <= h[1]:
                if s > now:
                    e = s + dur
                    busy = [b for b in booked if b["start_at"] < fmt(e) and b["end_at"] > fmt(s)]
                    bp = {b["provider_id"] for b in busy}
                    bo = {b["operatory_id"] for b in busy}
                    prov = next((p for p in provs if p["id"] not in bp), None)
                    op = next((o for o in ops if o["id"] not in bo), None)
                    if prov and op:
                        out.append({
                            "start_at": fmt(s), "end_at": fmt(e), "label": human(s), "type": type_,
                            "provider_id": prov["id"], "provider_name": prov["name"],
                            "operatory_id": op["id"], "operatory_name": op["name"],
                        })
                s += timedelta(minutes=SLOT_MIN)
        d += timedelta(days=1)
    return out


def spread(slots: list[dict], n: int) -> list[dict]:
    """Evenly sample n slots from a chronological list (deterministic)."""
    if len(slots) <= n:
        return slots
    return [slots[int(i * len(slots) / n)] for i in range(n)]


def day_schedule(conn, d: date) -> dict:
    h = hours_for(conn, d)
    ops = [dict(r) for r in conn.execute("SELECT * FROM operatories ORDER BY id")]
    week_start = d - timedelta(days=d.weekday())
    data = {
        "date": d.isoformat(), "weekday": d.strftime("%A"), "closed": h is None, "operatories": ops,
        "slots": [], "appointments": [],
        "utilisation": {"day": utilisation(conn, d, d), "week": utilisation(conn, week_start, week_start + timedelta(days=6))},
        "prev": (d - timedelta(days=1)).isoformat(), "next": (d + timedelta(days=1)).isoformat(),
    }
    if not h:
        return data
    s = h[0]
    while s < h[1]:
        data["slots"].append(time_label(s))
        s += timedelta(minutes=SLOT_MIN)
    rows = conn.execute(
        """SELECT a.id, a.operatory_id, a.start_at, a.end_at, a.type, a.status, a.source, a.provider_id,
                  p.first_name, p.last_name, pr.name AS provider_name, pr.color AS provider_color
           FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN providers pr ON pr.id=a.provider_id
           WHERE a.status IN ('scheduled','completed') AND a.start_at >= ? AND a.start_at < ? ORDER BY a.start_at""",
        (fmt(h[0]), fmt(h[1])),
    ).fetchall()
    for r in rows:
        st, en = parse_dt(r["start_at"]), parse_dt(r["end_at"])
        data["appointments"].append({
            "id": r["id"], "operatory_id": r["operatory_id"], "start_at": r["start_at"], "end_at": r["end_at"],
            "row": int((st - h[0]).total_seconds() // 60 // SLOT_MIN) + 1,
            "span": max(1, int((en - st).total_seconds() // 60 // SLOT_MIN)),
            "initials": (r["first_name"][:1] + r["last_name"][:1]).upper(),
            "type": r["type"], "status": r["status"], "source": r["source"],
            "ai": r["source"] in ("ai_inbound", "ai_recall"),
            "provider_name": r["provider_name"], "provider_color": r["provider_color"],
            "time": f"{time_label(st)}-{time_label(en)}",
        })
    return data


def utilisation(conn, d_from: date, d_to: date) -> float:
    n_ops = conn.execute("SELECT COUNT(*) FROM operatories").fetchone()[0]
    total = 0
    d = d_from
    while d <= d_to:
        h = hours_for(conn, d)
        if h:
            total += n_ops * int((h[1] - h[0]).total_seconds() // 60)
        d += timedelta(days=1)
    if not total:
        return 0.0
    rows = conn.execute(
        "SELECT start_at,end_at FROM appointments WHERE status IN ('scheduled','completed') AND start_at >= ? AND start_at < ?",
        (d_from.isoformat() + "T00:00", (d_to + timedelta(days=1)).isoformat() + "T00:00"),
    ).fetchall()
    booked = sum(int((parse_dt(r["end_at"]) - parse_dt(r["start_at"])).total_seconds() // 60) for r in rows)
    return round(100.0 * booked / total, 1)
