"""Deterministic scripted receptionist. Drives the SAME tools as the live agent.

State machine (kept in conversations.state_json):
  start/open -> identity -> (register) -> reason -> pick_slot -> confirm_book -> open
  plus: pick_appt -> confirm_cancel | pick_slot(reschedule) ; ins_details ; msg_collect
Recall conversations (mode == 'recall') have their own small reply handler.
"""
import re
from datetime import date, datetime, timedelta

from . import config
from . import scheduling as sch

MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
STOP = set("""my name is it's its i'm im i am this dob date of birth born on and hi hello hey the phone number a an new patient for calling again
please cell mobile you your can could would like to need want make book schedule reschedule cancel appointment appointments cleaning clean
checkup check-up check exam hygiene teeth tooth toothache pain emergency follow-up followup visit see dentist insurance coverage benefits
member id with is at in um uh yes yeah no thanks thank hours open i'd i'll ill sure ok okay just who what when where how do does have has
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
dr mr mrs ms miss from about call me morning afternoon next week tomorrow today also but so then if""".split())
PAYER_WORDS = {"delta": "Delta Mutual", "aetnor": "Aetnor", "aetna": "Aetnor", "bluecrest": "BlueCrest", "blue crest": "BlueCrest", "medicaid": "Medicaid-Demo"}
WEEKDAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
TYPE_LABEL = {"hygiene": "cleaning", "exam": "exam", "emergency": "emergency visit", "followup": "follow-up", "consult": "consultation"}
ORD = {"first": 0, "1st": 0, "one": 0, "1": 0, "second": 1, "2nd": 1, "two": 1, "2": 1, "third": 2, "3rd": 2, "three": 2, "3": 2, "last": -1}


# ----- parsing helpers -----
def parse_dob(text: str):
    pats = [
        (r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", lambda m: (int(m[1]), int(m[2]), int(m[3]))),
        (r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", lambda m: (int(m[3]), int(m[1]), int(m[2]))),
        (r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", lambda m: (int(m[3]), MONTHS.get(m[1][:3].lower(), 0), int(m[2]))),
        (r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b", lambda m: (int(m[3]), MONTHS.get(m[2][:3].lower(), 0), int(m[1]))),
    ]
    for p, f in pats:
        m = re.search(p, text)
        if m:
            try:
                y, mo, d = f(m)
                return date(y, mo, d).isoformat(), (text[:m.start()] + " " + text[m.end():])
            except ValueError:
                continue
    return None, text


def parse_phone(text: str):
    m = re.search(r"\+?\d[\d\s().-]{5,}\d", text)
    if m and len(re.sub(r"\D", "", m.group())) >= 7:
        return m.group().strip(), text[:m.start()] + " " + text[m.end():]
    return None, text


def parse_name(text: str):
    toks = re.findall(r"[A-Za-z][A-Za-z'’-]*", text)
    cand = [t for t in toks if t.lower() not in STOP and t.lower() not in ("dr",)]
    caps = [t for t in cand if t[0].isupper()]
    use = caps if len(caps) >= 2 else cand
    if len(use) >= 2:
        return use[0].capitalize(), use[1].capitalize()
    return None, None


def yes(low): return bool(re.search(r"\b(yes|yeah|yep|yup|sure|ok|okay|correct|right|please do|go ahead|sounds good|that works|confirm|do it|perfect)\b", low))
def no(low): return bool(re.search(r"\b(no|nope|nah|not really|don't|do not|wrong)\b", low))


def detect_type(low):
    if re.search(r"toothache|tooth ache|pain|hurts|hurt|emergency|swollen|swelling|broken|chipped|knocked|abscess|bleeding", low): return "emergency"
    if re.search(r"clean|hygien", low): return "hygiene"
    if re.search(r"follow", low): return "followup"
    if re.search(r"consult", low): return "consult"
    if re.search(r"exam|check-?up", low): return "exam"
    return None


def detect_intent(low):
    if re.search(r"(speak|talk|chat) (to|with) (a |an |the |your )?(real )?(person|human|someone|staff|receptionist|manager|dentist|doctor|office)|real person|billing|dispute|overcharg|complain|refund|leave a message|take a message|should i take|ibuprofen|antibiotic|prescription|is it safe|is it normal|what should i do", low):
        return "message"
    if re.search(r"\bcancel", low): return "cancel"
    if re.search(r"re-?schedul|move my|change my appointment|different time", low): return "reschedule"
    if re.search(r"(my|verify|check|confirm).*(insurance|coverage|benefits|eligib)|member id|am i covered|is my (insurance|plan)", low) or (
            re.search(r"insurance|coverage|benefits|eligib", low) and not re.search(r"accept|take|which|what insurance|work with|do you", low)):
        return "insurance"
    book = re.search(r"\b(book|appointment|schedule|cleaning|clean|check-?up|exam|toothache|emergency|hygiene|pain|visit|follow-?up|consult)", low)
    faq = faq_topic(low)
    if faq and not book: return "faq"
    if book: return "book"
    if re.search(r"(accept|take).*(insurance|delta|aetn|blue|medicaid)", low): return "faq"
    return None


def faq_topic(low):
    if re.search(r"hours|what time|when are you open|are you open|opening|closing|open (on|late|saturday|sunday)|close", low): return "hours"
    if re.search(r"parking|park\b", low): return "parking"
    if re.search(r"address|where (are|is)|located|location|directions", low): return "address"
    if re.search(r"(accept|take|work with|in.?network).*(insurance|delta|aetn|blue|medicaid)|which insurance|what insurance|insurers", low): return "insurance"
    if re.search(r"bring|what do i need|first visit", low): return "what_to_bring"
    if re.search(r"phone number|your number", low): return "phone"
    return None


def choose_index(low, items, key="start_at"):
    """Pick one of `items` from free text (ordinal, number, weekday or time). None if no pick."""
    m = re.findall(r"\b(first|1st|second|2nd|third|3rd|last|one|two|three|1|2|3)\b", low)
    if m:
        i = ORD[m[0]]
        i = len(items) - 1 if i == -1 else i
        if i < len(items): return i
    for i, it in enumerate(items):
        dt = sch.parse_dt(it[key])
        if WEEKDAY_NAMES[dt.weekday()] in low or WEEKDAY_NAMES[dt.weekday()][:3] + "day" in low: return i
    tm = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)", low)
    if tm:
        h = int(tm[1]) % 12 + (12 if tm[3].startswith("p") else 0)
        for i, it in enumerate(items):
            dt = sch.parse_dt(it[key])
            if dt.hour == h and dt.minute == int(tm[2] or 0): return i
    return None


def art(word):
    return ("an " if word[0] in "aeiou" else "a ") + word


def _desc(slot):
    return f"{slot['label']} with {slot['provider_name']} in {slot['operatory_name']}"


# ----- the receptionist -----
class Receptionist:
    def __init__(self, call, st):
        self.call, self.st = call, st
        st.setdefault("mode", "inbound")
        st.setdefault("step", "start")
        st.setdefault("pre", "")

    def reply(self, text: str) -> str:
        s = self.st
        if s["mode"] == "recall":
            return self.recall(text)
        low = text.lower().strip()
        intent = detect_intent(low)
        if s["step"] == "msg_collect":
            return self.finish(self.collect_message(text))
        if intent == "message":
            s["msg_summary"] = text
            s["clinical"] = bool(re.search(r"should i|ibuprofen|antibiotic|prescription|safe|normal|what should i do", low))
            return self.finish(self.start_message())
        step = s["step"]
        h = getattr(self, "step_" + step, None)
        return self.finish(h(text, low, intent) if h else self.step_start(text, low, intent))

    def finish(self, out: str) -> str:
        pre, self.st["pre"] = self.st.get("pre", ""), ""
        return (pre + " " + out).strip()

    # ---- step handlers ----
    def step_start(self, text, low, intent):
        s = self.st
        self.absorb_identity(text)
        if re.search(r"\b(thanks|thank you|bye|goodbye|that's all|that is all|nothing else|no thanks)\b", low) and not intent:
            return "You're welcome! Thanks for calling Maple Street Dental. Goodbye!"
        if not intent:
            return "I can book, reschedule or cancel appointments, check insurance benefits, or answer questions about the practice. What can I do for you?"
        s.update(intent=intent, slots=[], chosen=None, target=None, week_offset=0)
        s["type"] = detect_type(low) if intent == "book" else None
        return self.proceed()
    step_open = step_start

    def step_identity(self, text, low, intent):
        self.absorb_identity(text)
        return self.proceed()

    def step_register(self, text, low, intent):
        s = self.st
        low2 = low
        dob, rest = parse_dob(text)
        phone, _ = parse_phone(rest)
        if phone:
            r = self.call("create_patient", {"first_name": s["first"], "last_name": s["last"], "dob": s["dob"], "phone": phone})
            if r.get("ok"):
                s.update(patient_id=r["patient_id"], pref_hyg=None, insurance_on_file=None, phone=phone)
                s["pre"] = f"Welcome to Maple Street Dental, {s['first']}, you're registered."
                return self.proceed()
            return "I couldn't register that. Could you repeat your phone number and date of birth?"
        if no(low2) and not yes(low2):
            for k in ("first", "last", "dob"): s.pop(k, None)
            s["step"] = "identity"
            return "No problem. Let's try again: what's your full name and date of birth?"
        return "To register you I just need a good phone number. What is it?"

    def step_reason(self, text, low, intent):
        t = detect_type(low)
        if not t:
            return "Is this for a cleaning, an exam, a toothache or emergency, or a follow-up?"
        self.st["type"] = t
        return self.proceed()

    def step_pick_slot(self, text, low, intent):
        s = self.st
        i = choose_index(low, s["slots"])
        if i is None:
            if re.search(r"\b(none|neither|no|other|different|later|else|more)\b", low):
                s["week_offset"] = s.get("week_offset", 0) + 1
                s["slots"] = []
                return self.proceed()
            return "Sorry, which one works best? You can say first, second or third."
        s["chosen"] = s["slots"][i]
        s["step"] = "confirm_book"
        sl = s["chosen"]
        if s["intent"] == "reschedule":
            return f"Just to confirm: move your {TYPE_LABEL[s['type']]} to {_desc(sl)}. Shall I make that change?"
        return f"Just to confirm: {art(TYPE_LABEL[s['type']])} on {_desc(sl)}. Shall I book it?"

    def step_confirm_book(self, text, low, intent):
        s = self.st
        sl = s["chosen"]
        if yes(low) and not no(low):
            if s["intent"] == "reschedule":
                r = self.call("reschedule_appointment", {"appointment_id": s["target"]["id"], "new_start_at": sl["start_at"]})
            else:
                r = self.call("book_appointment", {"patient_id": s["patient_id"], "start_at": sl["start_at"],
                                                   "appointment_type": s["type"], "provider_id": sl["provider_id"], "operatory_id": sl["operatory_id"]})
            if r.get("ok"):
                verb = "rescheduled" if s["intent"] == "reschedule" else "booked"
                self.call("end_call", {"outcome": verb, "summary": f"{verb} {r['type']} {r['label']}"})
                s["step"] = "open"
                return (f"All set! Your {TYPE_LABEL[r['type']]} is {verb} for {r['label']} with {r['provider_name']} in {r['operatory_name']}. "
                        "Is there anything else I can help with?")
            s["slots"], s["chosen"] = [], None
            s["pre"] = f"I'm sorry, I couldn't book that one ({r.get('error', 'it was just taken')})"
            return self.proceed()
        if no(low):
            s["step"] = "pick_slot"
            return "No problem. Which of the other options works, or should I look at different days?"
        return "Should I go ahead and book it? Please say yes or no."

    def step_pick_appt(self, text, low, intent):
        s = self.st
        i = choose_index(low, s["appts"])
        if i is None:
            return "Sorry, which appointment do you mean? You can say first, second, or the day of the week."
        s["target"] = s["appts"][i]
        return self.after_target()

    def step_confirm_cancel(self, text, low, intent):
        s = self.st
        if yes(low) and not no(low):
            r = self.call("cancel_appointment", {"appointment_id": s["target"]["id"]})
            if r.get("ok"):
                self.call("end_call", {"outcome": "cancelled", "summary": f"cancelled {r['label']}"})
                s["step"] = "open"
                return f"Done. Your {TYPE_LABEL[r['type']]} on {r['label']} is cancelled. Would you like to book another time?"
            return f"I couldn't cancel that: {r.get('error')}. I can leave a message for the team if you like."
        if no(low):
            s["step"] = "open"
            return "Okay, I've left your appointment as is. Anything else?"
        return "Do you want me to cancel it? Please say yes or no."

    def step_ins_details(self, text, low, intent):
        self.absorb_insurance(text)
        self.absorb_identity(text)
        return self.proceed()

    # ---- helpers ----
    def absorb_identity(self, text):
        s = self.st
        if s.get("patient_id"):
            return
        dob, rest = parse_dob(text)
        if dob and not s.get("dob"): s["dob"] = dob
        _, rest2 = parse_phone(rest)
        first, last = parse_name(rest2)
        if first and not s.get("first"):
            s["first"], s["last"] = first, last

    def absorb_insurance(self, text):
        s = self.st
        low = text.lower()
        for k, v in PAYER_WORDS.items():
            if k in low: s["payer"] = v
        m = re.search(r"\b([A-Za-z]{2,4}-?\d{5,8})\b", text)
        if m: s["member_id"] = m[1].upper() if "-" in m[1] else re.sub(r"^([A-Za-z]+)(\d+)$", lambda x: x[1].upper() + "-" + x[2], m[1])
        dob, _ = parse_dob(text)
        if dob: s["ins_dob"] = dob

    def resolve_identity(self):
        """Return a prompt string if more info is needed, else None (patient_id set)."""
        s = self.st
        if s.get("patient_id"): return None
        s["step"] = "identity"
        if not s.get("first") or not s.get("dob"):
            if s.get("first") and not s.get("dob"):
                return f"Thanks, {s['first']}. And what's your date of birth?"
            if s.get("dob") and not s.get("first"):
                return "Thanks. And what's your full name?"
            return "Happy to help with that. First, may I have your full name and date of birth?"
        r = self.call("find_patient", {"first_name": s["first"], "last_name": s["last"], "dob": s["dob"]})
        if r.get("found"):
            s.update(patient_id=r["patient_id"], first=r["first_name"], phone=r.get("phone"), pref_hyg=r.get("preferred_hygienist_id"),
                     insurance_on_file=r.get("insurance_on_file"))
            s["pre"] = (s.get("pre", "") + f" Thanks, {r['first_name']}, I found you.").strip()
            return None
        if s["intent"] in ("cancel", "reschedule"):
            for k in ("first", "last", "dob"): s.pop(k, None)
            return "I couldn't find a patient with that name and date of birth. Could you give them to me again?"
        s["step"] = "register"
        return f"I don't see {s['first']} {s['last']} born {s['dob']} in our system. Would you like to register as a new patient? If so, what's your phone number?"

    def proceed(self):
        s = self.st
        intent = s["intent"]
        if intent == "faq": return self.do_faq()
        if intent == "insurance": return self.do_insurance()
        need = self.resolve_identity()
        if need: return need
        if intent == "book": return self.do_book()
        return self.do_manage()

    def offer_slots(self):
        s = self.st
        t = s["type"]
        start = config.today() + timedelta(days=7 * s.get("week_offset", 0))
        end = start + timedelta(days=3 if t == "emergency" else 13)
        args = {"date_from": start.isoformat(), "date_to": end.isoformat(), "appointment_type": t}
        if t == "hygiene" and s.get("pref_hyg") and s["intent"] == "book" and not s.get("week_offset"):
            args["provider_id"] = s["pref_hyg"]
        r = self.call("get_availability", args)
        slots = r.get("slots", [])
        if not slots and "provider_id" in args:
            args.pop("provider_id")
            slots = self.call("get_availability", args).get("slots", [])
        if not slots:
            s["msg_summary"] = f"Caller wants a {t} appointment but no openings were found."
            return "I'm not finding any openings in that window. " + self.start_message()
        picks = slots[:3] if t == "emergency" else sch.spread(slots, 3)
        s["slots"], s["step"] = picks, "pick_slot"
        listing = "; ".join(f"{i}) {_desc(p)}" for i, p in enumerate(picks, 1))
        verb = "move your visit to one of" if s["intent"] == "reschedule" else f"book your {TYPE_LABEL[t]} at one of"
        return f"I can {verb} these times: {listing}. Which works best?"

    def do_book(self):
        s = self.st
        if not s.get("type"):
            s["step"] = "reason"
            return "What brings you in: a cleaning, an exam, a toothache or emergency, or a follow-up?"
        return self.offer_slots()

    def do_manage(self):
        s = self.st
        r = self.call("get_patient_appointments", {"patient_id": s["patient_id"]})
        appts = r.get("appointments", [])
        if not appts:
            s["step"] = "open"
            return "I don't see any upcoming appointments for you. Would you like to book one?"
        s["appts"] = appts[:5]
        if len(appts) == 1:
            s["target"] = appts[0]
            return self.after_target()
        s["step"] = "pick_appt"
        listing = "; ".join(f"{i}) {a['label']} ({TYPE_LABEL[a['type']]})" for i, a in enumerate(s["appts"], 1))
        return f"I see these upcoming appointments: {listing}. Which one do you mean?"

    def after_target(self):
        s = self.st
        t = s["target"]
        if s["intent"] == "cancel":
            s["step"] = "confirm_cancel"
            return f"I'll cancel your {TYPE_LABEL[t['type']]} on {t['label']}. Is that right?"
        s["type"], s["slots"], s["week_offset"] = t["type"], [], 0
        return self.offer_slots()

    def do_faq(self):
        s = self.st
        topic = faq_topic(s.get("last_low", "")) or "hours"
        r = self.call("get_practice_info", {"topic": topic})
        self.call("end_call", {"outcome": "faq", "summary": f"answered {topic} question"})
        s["step"] = "open"
        return f"{r['answer']} Anything else I can help with?"

    def do_insurance(self):
        s = self.st
        if s.get("patient_id") is None and s.get("first") and s.get("dob") and not s.get("member_id"):
            self.resolve_identity_quiet()
        on_file = s.get("insurance_on_file")
        if on_file and not s.get("member_id"):
            s["payer"], s["member_id"] = on_file["payer"], on_file["member_id"]
            s["ins_dob"] = s.get("dob")
            s["pre"] += f" I'll check the {on_file['payer']} plan we have on file."
        if not (s.get("payer") and s.get("member_id") and (s.get("ins_dob") or s.get("dob"))):
            s["step"] = "ins_details"
            return "Happy to check. Which insurance company is it, what's your member ID, and what's the date of birth on the policy?"
        args = {"payer": s["payer"], "member_id": s["member_id"], "dob": s.get("ins_dob") or s["dob"]}
        if s.get("patient_id"): args["patient_id"] = s["patient_id"]
        r = self.call("verify_insurance", args)
        self.call("end_call", {"outcome": "insurance_verified", "summary": f"{s['payer']}: eligible={r['eligible']} flags={r['flags']}"})
        s["step"] = "open"
        for k in ("payer", "member_id", "ins_dob"): s.pop(k, None)
        return explain_insurance(r) + " Anything else I can help with?"

    def resolve_identity_quiet(self):
        s = self.st
        r = self.call("find_patient", {"first_name": s["first"], "last_name": s["last"], "dob": s["dob"]})
        if r.get("found"):
            s.update(patient_id=r["patient_id"], phone=r.get("phone"), pref_hyg=r.get("preferred_hygienist_id"), insurance_on_file=r.get("insurance_on_file"))

    def start_message(self):
        s = self.st
        clin = "I can't give clinical advice, but " if s.get("clinical") else ""
        if s.get("patient_id") and s.get("phone"):
            return self.send_message(f"{s['first']}", s["phone"])
        s["step"] = "msg_collect"
        body = "I'll pass this along to our team so a person can follow up. What's your name and the best phone number?"
        return ("I can't give clinical advice, but " + body[0].lower() + body[1:]) if clin else body

    def collect_message(self, text):
        s = self.st
        _, rest = parse_dob(text)
        phone, rest = parse_phone(rest)
        first, last = parse_name(rest)
        if not first and s.get("first"): first, last = s["first"], s.get("last")
        if not phone or not first:
            return "I still need your name and a phone number to leave the message. Could you give me both?"
        return self.send_message(f"{first} {last}", phone)

    def send_message(self, name, phone):
        s = self.st
        full = name if " " in name or not s.get("last") else f"{name} {s['last']}"
        self.call("take_message", {"patient_name": full, "phone": phone, "summary": s.get("msg_summary", "Caller asked for a call back")[:400]})
        self.call("end_call", {"outcome": "message_taken", "summary": "message left for staff"})
        s["step"] = "open"
        return "I've left that message for our team and someone will call you back. Is there anything else?"

    # ---- recall (SMS thread) ----
    def recall(self, text):
        s = self.st
        low = text.lower()
        slots = s.get("slots", [])
        if s["step"] == "done":
            return "You're all set. Reply anytime if you need to change it. Reply STOP to opt out."
        if re.search(r"\bstop\b|unsubscribe|not interested|moved|remove me|wrong number|no longer|switched dentist|new dentist", low):
            self.call("end_call", {"outcome": "declined", "summary": "patient opted out / not interested"})
            s["step"] = "done"
            return "Understood, we won't text you again about recall. Take care!"
        if re.search(r"later|next month|next week|call (me )?back|not now|busy|after (the|my)|in a few|few weeks|snooze|remind me", low):
            self.call("end_call", {"outcome": "snoozed", "summary": "patient asked to be contacted later"})
            s["step"] = "done"
            return "No problem, we'll check back with you later. Reply anytime if you'd like to book sooner."
        i = choose_index(low, slots)
        positive = yes(low) or re.search(r"\b(works?|book|good|fine)\b", low)
        if i is None and positive and slots:
            i = 0
        if i is not None:
            sl = slots[i]
            r = self.call("book_appointment", {"patient_id": s["patient_id"], "start_at": sl["start_at"], "appointment_type": "hygiene",
                                               "provider_id": sl["provider_id"], "operatory_id": sl["operatory_id"]})
            if r.get("ok"):
                self.call("end_call", {"outcome": "booked", "summary": f"booked via recall {r['label']}"})
                s["step"] = "done"
                return f"Booked! Your cleaning is {r['label']} with {r['provider_name']} in {r['operatory_name']}. See you then, {s.get('first_name', '')}!".replace(" ,", ",")
            av = self.call("get_availability", {"date_from": (config.today() + timedelta(days=1)).isoformat(),
                                                 "date_to": (config.today() + timedelta(days=14)).isoformat(), "appointment_type": "hygiene"})
            s["slots"] = sch.spread(av.get("slots", []), 2)
            if s["slots"]:
                return "Sorry, that time was just taken. I can offer " + " or ".join(f"({n}) {p['label']}" for n, p in enumerate(s["slots"], 1)) + ". Which works?"
            return "Sorry, that time was just taken and I don't see other openings. Our team will reach out."
        if no(low):
            self.call("end_call", {"outcome": "declined", "summary": "patient declined"})
            s["step"] = "done"
            return "No problem, thanks for letting us know. Take care!"
        return "Which time works for you? Reply 1 or 2, or tell us a day that suits you. Reply STOP to opt out."


def explain_insurance(r: dict) -> str:
    if not r["found"]:
        return f"I couldn't find that member ID with {r['payer']} for that date of birth. Could you double-check the card, or would you like our team to follow up?"
    if not r["eligible"]:
        return (f"I checked {r['payer']} and their records show this coverage as inactive, so I can't confirm benefits right now. "
                "Our team can help you with options, such as updating your plan details.")
    cov = r["coverage"]
    net = "in-network" if r["in_network"] else "out-of-network"
    out = (f"Good news: your {r['plan_name']} is active, and our practice is {net} for it. "
           f"It covers about {cov['preventive']}% of preventive care, {cov['basic']}% of basic and {cov['major']}% of major work. "
           f"You have roughly ${r['remaining_max']:,.0f} left of a ${r['annual_max']:,.0f} annual maximum.")
    notes = []
    if "out_of_network" in r["flags"]: notes.append("because we're out-of-network your out-of-pocket cost may be higher")
    if "low_remaining_max" in r["flags"]: notes.append("your remaining maximum is low, so it could run out soon")
    if "waiting_period" in r["flags"]: notes.append(f"there's a waiting period ({r.get('waiting_period')})")
    if notes: out += " Please note " + "; ".join(notes) + "."
    return out + " These are estimates, not a promise of exact cost."


def respond(call, state: dict, text: str) -> str:
    rec = Receptionist(call, state)
    state["last_low"] = text.lower()
    return rec.reply(text)
