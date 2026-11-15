from datetime import timedelta

import pytest

from app import config, insurance, recall, scheduling as sch


def tomorrow_open_day():
    d = config.today() + timedelta(days=1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def test_seed_shape(conn):
    assert conn.execute("SELECT COUNT(*) FROM operatories").fetchone()[0] == 4
    assert conn.execute("SELECT COUNT(*) FROM providers WHERE role='dentist'").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM providers WHERE role='hygienist'").fetchone()[0] == 2
    assert conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0] >= 30
    assert len(recall.overdue_patients(conn)) >= 8
    d = tomorrow_open_day()
    assert 50 <= sch.utilisation(conn, d, d) <= 70


def test_availability_excludes_booked_chair_and_provider(conn):
    d = tomorrow_open_day()
    slots = sch.open_slots(conn, d, d, "hygiene")
    assert slots
    s = slots[0]
    pid = conn.execute("SELECT id FROM patients WHERE first_name='Zoe'").fetchone()[0]
    sch.create_appointment(conn, pid, s["provider_id"], s["operatory_id"], s["start_at"], "hygiene", "staff")
    after = sch.open_slots(conn, d, d, "hygiene")
    for a in after:
        if a["start_at"] == s["start_at"]:
            assert a["provider_id"] != s["provider_id"] and a["operatory_id"] != s["operatory_id"]
    # an overlapping later start inside the 60 minute window must also exclude that chair/provider
    for a in after:
        if s["start_at"] < a["start_at"] < s["end_at"]:
            assert a["provider_id"] != s["provider_id"] and a["operatory_id"] != s["operatory_id"]


def test_double_booking_rejected(conn):
    d = tomorrow_open_day()
    s = sch.open_slots(conn, d, d, "hygiene")[0]
    p1, p2 = [r[0] for r in conn.execute("SELECT id FROM patients WHERE first_name IN ('Zoe','Mei') ORDER BY id")]
    sch.create_appointment(conn, p1, s["provider_id"], s["operatory_id"], s["start_at"], "hygiene", "staff")
    with pytest.raises(sch.BookingError, match="chair|provider"):
        sch.create_appointment(conn, p2, 4 if s["provider_id"] == 3 else 3, s["operatory_id"], s["start_at"], "hygiene", "staff")
    other_op = 1 if s["operatory_id"] != 1 else 2
    with pytest.raises(sch.BookingError, match="chair|provider"):
        sch.create_appointment(conn, p2, s["provider_id"], other_op, s["start_at"], "hygiene", "staff")
    # the DB trigger is a second line of defence even if the Python check is bypassed
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO appointments(patient_id,provider_id,operatory_id,start_at,end_at,type,status,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (p2, s["provider_id"], other_op, s["start_at"], s["end_at"], "hygiene", "scheduled", "staff", "now"))


def test_wrong_role_and_closed_day(conn):
    d = tomorrow_open_day()
    pid = conn.execute("SELECT id FROM patients WHERE first_name='Zoe'").fetchone()[0]
    with pytest.raises(sch.BookingError, match="hygienist"):
        sch.create_appointment(conn, pid, 1, 1, f"{d}T08:00", "hygiene")
    sunday = config.today() + timedelta(days=(6 - config.today().weekday()) % 7 or 7)
    with pytest.raises(sch.BookingError, match="closed"):
        sch.create_appointment(conn, pid, 3, 1, f"{sunday}T09:00", "hygiene")


def test_overdue_detection_relative_dates(conn):
    over = recall.overdue_patients(conn)
    names = {f"{p['first_name']} {p['last_name']}" for p in over}
    assert "Maria Gonzalez" in names
    assert "Sofia Marino" not in names          # old last visit but has a future appointment
    assert "Zoe Carter" not in names            # recent visit
    assert all(p["months_since"] >= 6 for p in over)
    # booking a future appointment removes the patient from the overdue list
    maria = next(p for p in over if p["first_name"] == "Maria")
    s = sch.open_slots(conn, config.today(), config.today() + timedelta(days=14), "hygiene")[0]
    sch.create_appointment(conn, maria["id"], s["provider_id"], s["operatory_id"], s["start_at"], "hygiene", "staff")
    assert "Maria Gonzalez" not in {f"{p['first_name']} {p['last_name']}" for p in recall.overdue_patients(conn)}
    # a larger RECALL window shrinks the list
    assert len(recall.overdue_patients(conn, months=12)) < len(over)


def test_insurance_flags(conn):
    def ver(first, last):
        p = conn.execute("SELECT id,dob FROM patients WHERE first_name=? AND last_name=?", (first, last)).fetchone()
        plan = conn.execute("SELECT payer,member_id FROM insurance_plans WHERE patient_id=?", (p["id"],)).fetchone()
        return insurance.verify(conn, plan["payer"], plan["member_id"], p["dob"], p["id"], "staff"), p["id"]

    r, pid = ver("Tom", "Becker")
    assert r["eligible"] is False and "inactive_member" in r["flags"]
    r, _ = ver("Oscar", "Fernandes")
    assert r["eligible"] and r["in_network"] is False and "out_of_network" in r["flags"]
    r, _ = ver("Priyanka", "Shah")
    assert "low_remaining_max" in r["flags"] and r["remaining_max"] < 200
    r, _ = ver("Grace", "Okonkwo")
    assert "waiting_period" in r["flags"]
    r, _ = ver("Maria", "Gonzalez")
    assert r["eligible"] and r["flags"] == []
    assert conn.execute("SELECT verified_at FROM insurance_plans WHERE patient_id=?", (pid,)).fetchone()[0]
    nf = insurance.verify(conn, "Delta Mutual", "NOPE-1", "1990-01-01")
    assert nf["eligible"] is False and "member_not_found" in nf["flags"]
