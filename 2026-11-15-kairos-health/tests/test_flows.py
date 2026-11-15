import json
from datetime import timedelta

from app import config, llm
from tests.conftest import Caller


def schedule_has(client, appt_id, date):
    sched = client.get(f"/api/schedule?date={date}").json()
    return any(a["id"] == appt_id for a in sched["appointments"])


def test_health_and_pages(client):
    assert client.get("/health").json()["mode"] == "mock"
    for p in ["/", "/schedule", "/recall", "/insurance", "/calls", "/messages"]:
        r = client.get(p)
        assert r.status_code == 200, p
    assert "MOCK MODE" in client.get("/").text
    assert "Maple Street Dental" in client.get("/schedule").text


def test_reset_is_idempotent(client):
    a = client.post("/api/demo/reset").json()["seeded"]
    b = client.post("/api/demo/reset").json()["seeded"]
    assert a["named_patients"] == b["named_patients"] == 30
    assert b["scheduled_appointments"] > 200


def test_inbound_booking_end_to_end(client, caller):
    caller.say("Hi, I need a cleaning")
    r = caller.say("Maria Gonzalez, 1984-03-12")
    assert [t["name"] for t in r["tool_calls"]] == ["find_patient", "get_availability"]
    assert caller.say("the second one")["tool_calls"] == []   # confirmation comes before booking
    r = caller.say("yes please")
    names = [t["name"] for t in r["tool_calls"]]
    assert names == ["book_appointment", "end_call"] and r["outcome"] == "booked"
    appt = r["tool_calls"][0]["result"]
    assert appt["booked"] and appt["provider_name"] in r["reply"] and appt["operatory_name"] in r["reply"]
    assert schedule_has(client, appt["appointment_id"], appt["start_at"][:10])
    sched = client.get(f"/api/schedule?date={appt['start_at'][:10]}").json()
    ai = [a for a in sched["appointments"] if a["id"] == appt["appointment_id"]][0]
    assert ai["ai"] and ai["source"] == "ai_inbound" and ai["initials"] == "MG"
    c = client.get(f"/api/conversations/{caller.id}").json()
    assert c["outcome"] == "booked" and c["mode"] == "mock" and len(c["tool_calls"]) >= 3
    assert any("Maria" in t["text"] or "booked" in t["text"] for t in c["transcript"])


def test_offers_at_most_three_slots(client, caller):
    r = caller.say("I need a cleaning")
    r = caller.say("Maria Gonzalez 1984-03-12")
    assert r["reply"].count(";") <= 2 and "4)" not in r["reply"]


def test_new_patient_registration_and_booking(client, caller):
    caller.say("I'd like an exam")
    r = caller.say("Jane Doe, March 3, 1990")
    assert "register" in r["reply"]
    r = caller.say("yes, 555-222-3333")
    assert r["tool_calls"][0]["name"] == "create_patient"
    caller.say("first")
    r = caller.say("yes")
    assert r["outcome"] == "booked"


def test_reschedule_and_cancel(client):
    c = Caller(client)
    c.say("I want to reschedule my appointment")
    r = c.say("Sofia Marino 1988-06-06")
    assert [t["name"] for t in r["tool_calls"]] == ["find_patient", "get_patient_appointments", "get_availability"]
    old = r["tool_calls"][1]["result"]["appointments"][0]
    c.say("the second one")
    r = c.say("yes")
    assert r["outcome"] == "rescheduled"
    new = r["tool_calls"][0]["result"]
    assert new["appointment_id"] == old["id"] and new["start_at"] != old["start_at"]
    assert schedule_has(client, old["id"], new["start_at"][:10])
    assert not schedule_has(client, old["id"], old["start_at"][:10])

    c2 = Caller(client)
    c2.say("I need to cancel my appointment")
    c2.say("Sofia Marino 1988-06-06")
    r = c2.say("yes")
    assert r["outcome"] == "cancelled" and r["tool_calls"][0]["name"] == "cancel_appointment"
    assert not schedule_has(client, old["id"], new["start_at"][:10])


def test_slot_taken_is_relayed_with_alternatives(client, conn):
    c = Caller(client)
    c.say("I need a cleaning")
    r = c.say("Maria Gonzalez 1984-03-12")
    slot = r["tool_calls"][1]["result"]["slots"][0]
    c.say("first")
    # someone else grabs the slot between offer and confirmation
    from app import scheduling as sch
    zoe = conn.execute("SELECT id FROM patients WHERE first_name='Zoe'").fetchone()[0]
    sch.create_appointment(conn, zoe, slot["provider_id"], slot["operatory_id"], slot["start_at"], "hygiene", "staff")
    r = c.say("yes")
    assert r["tool_calls"][0]["result"]["ok"] is False
    assert "sorry" in r["reply"].lower() and "Which works best" in r["reply"]


def test_faq_insurance_and_message(client):
    c = Caller(client)
    r = c.say("What are your hours?")
    assert r["outcome"] == "faq" and "8:00 AM" in r["reply"]
    r = c.say("Where is parking?")
    assert "parking" in r["reply"].lower()
    c2 = Caller(client)
    c2.say("I want to speak to someone about my bill")
    r = c2.say("Sam Newton 555-123-4567")
    assert r["outcome"] == "message_taken"
    msgs = client.get("/api/messages").json()
    assert msgs[0]["patient_name"] == "Sam Newton" and msgs[0]["phone"] == "555-123-4567" and not msgs[0]["done"]
    assert client.post(f"/api/messages/{msgs[0]['id']}/done").json()["done"] is True
    assert client.get("/api/messages").json()[0]["done"] == 1
    r = Caller(client).say("should I take ibuprofen for my toothache")
    assert "clinical advice" in r["reply"]


def test_insurance_via_call_and_api(client):
    c = Caller(client)
    c.say("Can you check my insurance?")
    r = c.say("Tom Becker 1968-01-30")
    assert r["outcome"] == "insurance_verified" and "inactive" in r["reply"]
    r = client.post("/api/insurance/verify", json={"payer": "Delta Mutual", "member_id": "DM-100000", "dob": "1984-03-12"}).json()
    assert r["found"] is True or r["flags"] == ["member_not_found"]  # payer rotation decides which payer owns the ID
    plan = client.get("/insurance")
    assert plan.status_code == 200
    r = client.post("/api/insurance/verify", json={"payer": "Medicaid-Demo", "member_id": "MD-100003", "dob": "1968-01-30"}).json()
    assert r["eligible"] is False and "inactive_member" in r["flags"]


def test_recall_run_and_yes_reply_books(client):
    overdue = client.get("/api/recall/overdue").json()
    n = len(overdue["patients"])
    assert n >= 8
    run = client.post("/api/recall/run").json()
    assert run["created"] == n and run["counters"]["sent"] == n
    again = client.post("/api/recall/run").json()
    assert again["created"] == 0                      # idempotent: no duplicate outreach
    msg = run["outreach"][0]
    assert "STOP" in msg["message"] and msg["message"].startswith("Hi ")
    r = client.post(f"/api/recall/{msg['id']}/reply", json={"text": "yes, the first one works"}).json()
    assert r["status"] == "booked" and r["outcome"] == "booked"
    booked = r["tool_calls"][0]["result"]
    assert booked["booked"] and schedule_has(client, booked["appointment_id"], booked["start_at"][:10])
    sched = client.get(f"/api/schedule?date={booked['start_at'][:10]}").json()
    assert [a for a in sched["appointments"] if a["id"] == booked["appointment_id"]][0]["source"] == "ai_recall"
    # booked patient is no longer overdue; declines and snoozes are tracked
    assert client.get("/api/recall/overdue").json()["counters"]["booked"] == 1
    o2, o3 = run["outreach"][1], run["outreach"][2]
    assert client.post(f"/api/recall/{o2['id']}/reply", json={"text": "I moved, please stop"}).json()["status"] == "declined"
    assert client.post(f"/api/recall/{o3['id']}/reply", json={"text": "call me next month"}).json()["status"] == "snoozed"
    c = client.get("/api/recall/outreach").json()["counters"]
    assert c["replies"] == 3 and c["booked"] == 1


def test_stats_counts(client):
    c = Caller(client)
    c.say("What are your hours?")
    c.say("I'd like to speak to a person")
    c.say("Sam Newton 555-123-4567")
    c = Caller(client)
    c.say("Can you check my insurance?")
    c.say("Tom Becker 1968-01-30")
    client.post("/api/recall/run")
    s = client.get("/api/stats").json()
    assert s["calls_handled"] == 2 and s["messages_taken"] == 1 and s["insurance_verifications"] == 1
    assert s["recall_sent"] >= 8 and s["recall_booked"] == 0 and s["ai_bookings"] == 0
    assert client.get("/calls").status_code == 200


def test_end_conversation_marks_abandoned(client, caller):
    caller.say("hello")
    assert client.post(f"/api/conversations/{caller.id}/end").json()["outcome"] == "abandoned"
    assert client.get("/api/conversations/9999").status_code == 404


def test_availability_endpoint(client):
    d1 = config.today().isoformat()
    d2 = (config.today() + timedelta(days=7)).isoformat()
    r = client.get(f"/api/availability?date_from={d1}&date_to={d2}&type=hygiene").json()
    assert r["count"] > 0 and {"start_at", "provider_name", "operatory_name"} <= set(r["slots"][0])
    assert client.get("/api/availability?type=nope").status_code == 400


# ---- live-mode tool loop, exercised with a fake Anthropic client (no network) ----
class _Block:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class _FakeMessages:
    def __init__(self):
        self.calls = []

    def create(self, **kw):
        self.calls.append(json.loads(json.dumps(kw["messages"])))
        assert "tool_choice" not in kw and kw["max_tokens"] == 2048
        assert all(t["strict"] and t["input_schema"]["additionalProperties"] is False for t in kw["tools"])
        if len(self.calls) == 1:
            return _Block(stop_reason="tool_use", content=[
                _Block(type="text", text="Let me check."),
                _Block(type="tool_use", id="t1", name="get_practice_info", input={"topic": "parking"}),
                _Block(type="tool_use", id="t2", name="end_call", input={"outcome": "faq", "summary": "parking"})])
        return _Block(stop_reason="end_turn", content=[_Block(type="text", text="Free lot behind the building.")])


class _FakeClient:
    def __init__(self):
        self.messages = _FakeMessages()


def test_live_tool_loop_with_fake_client(client, conn, monkeypatch):
    from app import agent
    cid = agent.create_conversation(conn, "inbound")["id"]
    conn.execute("UPDATE conversations SET mode='live' WHERE id=?", (cid,))
    conn.commit()
    fake = _FakeClient()
    res = agent.run_turn(conn, cid, "Where do I park?", client=fake)
    assert res["reply"] == "Free lot behind the building." and res["outcome"] == "faq"
    assert [t["name"] for t in res["tool_calls"]] == ["get_practice_info", "end_call"]
    second = fake.messages.calls[1]
    # both tool results go back in ONE user message
    last = second[-1]
    assert last["role"] == "user" and [b["tool_use_id"] for b in last["content"]] == ["t1", "t2"]
    stored = json.loads(conn.execute("SELECT messages_json FROM conversations WHERE id=?", (cid,)).fetchone()[0])
    assert any(isinstance(m["content"], list) for m in stored)   # tool blocks persisted for multi-turn
