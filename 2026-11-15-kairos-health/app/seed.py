"""Fictional demo data, generated relative to today so the demo never goes stale."""
import json
import random
from datetime import date, datetime, timedelta

from . import config, scheduling as sch

HOURS = {"mon": ["08:00", "17:00"], "tue": ["08:00", "17:00"], "wed": ["08:00", "17:00"], "thu": ["08:00", "17:00"],
         "fri": ["08:00", "17:00"], "sat": ["09:00", "13:00"], "sun": None}
PAYERS = ["Delta Mutual", "Aetnor", "BlueCrest", "Medicaid-Demo"]
PREFIX = {"Delta Mutual": "DM", "Aetnor": "AE", "BlueCrest": "BC", "Medicaid-Demo": "MD"}
PLAN_NAME = {"Delta Mutual": "Delta Mutual PPO Plus", "Aetnor": "Aetnor Choice Select",
             "BlueCrest": "BlueCrest Dental Gold", "Medicaid-Demo": "Medicaid-Demo Basic"}
COVERAGE = {"Delta Mutual": (100, 80, 50), "Aetnor": (100, 80, 50), "BlueCrest": (100, 70, 40), "Medicaid-Demo": (100, 60, 0)}

# (first, last, dob). Index 0-9 overdue; 10 old last visit but has a future appt; 11-29 recent.
NAMED = [
    ("Maria", "Gonzalez", "1984-03-12"), ("James", "Whitfield", "1976-11-02"), ("Aisha", "Rahman", "1991-07-23"),
    ("Tom", "Becker", "1968-01-30"), ("Linh", "Tran", "1989-09-09"), ("Oscar", "Fernandes", "1994-05-17"),
    ("Priyanka", "Shah", "1982-12-01"), ("Daniel", "Kowalski", "1973-04-21"), ("Grace", "Okonkwo", "1997-08-14"),
    ("Henry", "Liu", "1960-02-27"), ("Sofia", "Marino", "1988-06-06"), ("Ethan", "Brooks", "2001-10-10"),
    ("Chloe", "Dubois", "1993-03-03"), ("Marcus", "Reed", "1979-07-07"), ("Yuki", "Tanaka", "1986-01-19"),
    ("Fatima", "Hassan", "1999-11-25"), ("Liam", "O'Connor", "1970-05-05"), ("Nora", "Petrov", "1983-09-30"),
    ("Ravi", "Menon", "1977-12-12"), ("Isabel", "Cruz", "1995-04-04"), ("Jacob", "Stein", "1965-08-18"),
    ("Hannah", "Wells", "2003-02-14"), ("Victor", "Almeida", "1981-10-29"), ("Emma", "Nguyen", "1990-06-16"),
    ("Samuel", "Adeyemi", "1987-03-27"), ("Olivia", "Park", "1996-12-20"), ("Noah", "Fischer", "1974-07-31"),
    ("Zoe", "Carter", "2000-09-05"), ("Andre", "Silva", "1969-11-11"), ("Mei", "Chen", "1992-01-08"),
]
FIRST = ["Alex", "Beth", "Carlos", "Dana", "Eli", "Faith", "Gus", "Holly", "Ian", "Jade", "Kyle", "Lena", "Milo", "Nina", "Owen", "Pia", "Quinn", "Rosa", "Seth", "Tara"]
LAST = ["Abbott", "Baker", "Cole", "Dunn", "Ellis", "Frost", "Grant", "Hayes", "Irwin", "Jones", "Kerr", "Lowe", "Moss", "Nash", "Olsen", "Pratt", "Quast", "Rowe", "Shaw", "Tate"]

# Special insurance scenarios by named-patient index
INACTIVE = 3        # Tom Becker
OUT_OF_NETWORK = 5  # Oscar Fernandes
LOW_MAX = 6         # Priyanka Shah (remaining $150)
WAITING = 8         # Grace Okonkwo (waiting period on major)


def _months_ago(today: date, months: float) -> date:
    return today - timedelta(days=int(months * 30.44))


def _weekday_on_or_before(d: date) -> date:
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def seed(conn) -> dict:
    rng = random.Random(20261115)
    today = config.today()
    now_s = config.now().isoformat(timespec="seconds")

    conn.execute(
        "INSERT INTO practice VALUES (1,?,?,?,?,?,?,?,?)",
        ("Maple Street Dental", "(555) 010-0100", "212 Maple Street, Springfield (fictional)", json.dumps(HOURS),
         "Free parking in the lot behind the building; enter from Oak Avenue. Two accessible spots by the back door.",
         "Photo ID, your insurance card, and a list of current medications. New patients: arrive 10 minutes early.",
         json.dumps(PAYERS),
         json.dumps([
             {"q": "Do you see children?", "a": "Yes, we see patients of all ages."},
             {"q": "What if I need to cancel?", "a": "Please give us 24 hours notice so we can offer the chair to someone else."},
             {"q": "Do you take emergencies?", "a": "Yes, we hold same-day emergency slots when we can."},
         ])),
    )
    provs = [(1, "Dr. Alice Moreno", "dentist", "#4f7cff"), (2, "Dr. Ben Okafor", "dentist", "#7a5af8"),
             (3, "Hannah Lee", "hygienist", "#12b886"), (4, "Priya Nair", "hygienist", "#f59f00")]
    conn.executemany("INSERT INTO providers VALUES (?,?,?,?)", provs)
    conn.executemany("INSERT INTO operatories VALUES (?,?)", [(i, f"Chair {i}") for i in range(1, 5)])

    # patients
    pids = []
    for i, (f, l, dob) in enumerate(NAMED):
        hyg = 3 if i % 2 == 0 else 4
        if i % 9 == 8:
            hyg = None
        cur = conn.execute(
            "INSERT INTO patients(first_name,last_name,dob,phone,email,preferred_hygienist_id,created_at) VALUES (?,?,?,?,?,?,?)",
            (f, l, dob, f"(555) 010-{200 + i:04d}", f"{f.lower()}.{l.lower().replace(chr(39), '')}@example.test", hyg, now_s))
        pids.append(cur.lastrowid)
    fillers = []
    for i in range(100):
        f, l = FIRST[i % 20], LAST[(i * 7 + i // 20) % 20]
        dob = f"{rng.randint(1950, 2008)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}"
        cur = conn.execute(
            "INSERT INTO patients(first_name,last_name,dob,phone,preferred_hygienist_id,notes,created_at) VALUES (?,?,?,?,?,?,?)",
            (f, l + f"-{i}", dob, f"(555) 020-{i:04d}", rng.choice([3, 4]), "background patient (keeps the schedule busy)", now_s))
        fillers.append(cur.lastrowid)

    # completed history
    def history(pid, months_since_last, hyg):
        for k, m in enumerate([months_since_last, months_since_last + 6.2]):
            d = _weekday_on_or_before(_months_ago(today, m))
            start = datetime.combine(d, datetime.min.time()) + timedelta(hours=rng.choice([8, 9, 10, 11, 13, 14, 15]))
            sch.create_appointment(conn, pid, hyg or rng.choice([3, 4]), rng.randint(1, 4), sch.fmt(start), "hygiene",
                                   "staff", allow_past=True, status="completed")

    for i, pid in enumerate(pids):
        hyg = conn.execute("SELECT preferred_hygienist_id FROM patients WHERE id=?", (pid,)).fetchone()[0]
        if i < 10:
            history(pid, 7 + (i * 1.1), hyg)        # 7..17 months ago: overdue
        elif i == 10:
            history(pid, 9, hyg)                    # old, but will get a future appointment
        else:
            history(pid, 1 + (i % 5) * 0.9, hyg)    # recent
    for pid in fillers:
        history(pid, rng.uniform(1, 5), None)

    # staff pre-booked future schedule: ~60% of chair time on the next 10 business days
    future_named = [pids[10]] + pids[11:20]  # one future appt each; 0-9 stay overdue, 20-29 stay free
    cap = {p: 1 for p in future_named}
    for p in fillers:
        cap[p] = 3
    pool = future_named + fillers
    d, days = today + timedelta(days=1), 0
    while days < 10:
        if d.weekday() < 5:
            days += 1
            _fill_day(conn, rng, d, pool, cap)
        d += timedelta(days=1)

    # insurance
    n_plans = 0
    for i, pid in enumerate(pids[:20]):
        payer = PAYERS[i % 4]
        member = f"{PREFIX[payer]}-{100000 + i}"
        dob = NAMED[i][2]
        cov = COVERAGE[payer]
        coverage = {"preventive": cov[0], "basic": cov[1], "major": cov[2],
                    "copay_notes": "No copay for cleanings and exams; fillings subject to deductible."}
        annual = 1000.0 if payer == "Medicaid-Demo" else 1500.0
        remaining = float(rng.choice([420, 780, 1100, 1350, annual]))
        status, in_net, notes = "active", 1, ""
        if i == INACTIVE:
            status, notes = "inactive", "coverage terminated"
        if i == OUT_OF_NETWORK:
            in_net, notes = 0, "practice out of network"
        if i == LOW_MAX:
            remaining, notes = 150.0, "annual maximum nearly used"
        if i == WAITING:
            coverage["waiting_period"] = "major services: 6 months from effective date"
        conn.execute("INSERT INTO payer_directory VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (payer, member, dob, status, PLAN_NAME[payer], in_net, annual, remaining, json.dumps(coverage), notes))
        conn.execute("INSERT INTO insurance_plans(patient_id,payer,member_id,group_no,status) VALUES (?,?,?,?,?)",
                     (pid, payer, member, f"GRP{1000 + i}", "unverified"))
        n_plans += 1
    # a directory-only member (for staff to try the form without a patient on file)
    conn.execute("INSERT INTO payer_directory VALUES (?,?,?,?,?,?,?,?,?,?)",
                 ("BlueCrest", "BC-900001", "1990-01-01", "active", PLAN_NAME["BlueCrest"], 1, 1500.0, 1200.0,
                  json.dumps({"preventive": 100, "basic": 70, "major": 40, "copay_notes": "Demo member."}), ""))
    conn.commit()
    n_appts = conn.execute("SELECT COUNT(*) FROM appointments WHERE status='scheduled'").fetchone()[0]
    return {"patients": len(pids) + len(fillers), "named_patients": len(pids), "scheduled_appointments": n_appts, "insurance_plans": n_plans}


def _fill_day(conn, rng, d, pool, cap):
    h = sch.hours_for(conn, d)
    n_slots = int((h[1] - h[0]).total_seconds() // 60 // sch.SLOT_MIN)
    target = int(0.6 * 4 * n_slots)
    filled = 0
    attempts = 0
    types = ["hygiene"] * 5 + ["exam"] * 2 + ["followup"] * 2 + ["consult"]
    while filled < target and attempts < 1500:
        attempts += 1
        t = rng.choice(types)
        dur = sch.DURATIONS[t]
        start = h[0] + timedelta(minutes=sch.SLOT_MIN * rng.randrange(0, n_slots))
        if start + timedelta(minutes=dur) > h[1]:
            continue
        role = sch.ROLE_FOR[t]
        provs = [r[0] for r in conn.execute("SELECT id FROM providers WHERE role=?", (role,))]
        pid = rng.choice(pool)
        if cap[pid] <= 0:
            continue
        try:
            sch.create_appointment(conn, pid, rng.choice(provs), rng.randint(1, 4), sch.fmt(start), t, "staff", allow_past=True)
        except sch.BookingError:
            continue
        cap[pid] -= 1
        filled += dur // sch.SLOT_MIN
