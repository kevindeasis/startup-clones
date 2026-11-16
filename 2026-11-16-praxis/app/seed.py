"""First-start seed: fictional firm, rules, templates, clients, matters and inquiries. All data is fictional."""
import json
import os
import secrets
from datetime import date, timedelta

from . import db, letters

FIRM = {
    "name": "Harbor & Vale LLP",
    "address": "200 Harbor Street, Suite 1400, New York, NY 10004",
    "phone": "(212) 555-0142",
    "email": "intake@harborvale.example",
    "practice_areas": ["Business", "Employment", "Real estate", "Intellectual property"],
    "consult_policy": "Free 20-minute video consult for new inquiries, offered after a conflict check.",
    "bar_referral_line": "If you need help finding another attorney, the state bar association's lawyer-referral service can connect you with a qualified lawyer (in New York: nysba.org, Lawyer Referral Service).",
}
LAWYER = "Elena Vale, Partner"

CHECKLISTS = {
    "employment": [
        ("Government-issued photo ID", "Driver license or passport that is not expired", 1),
        ("Employment agreement", "Offer letter or signed employment contract", 1),
        ("Termination letter", "Any notice or email ending your employment", 1),
        ("Pay stubs (last 3)", "Your three most recent pay stubs", 1),
        ("Any written complaints", "Emails or HR reports where you raised concerns", 0),
    ],
    "business": [
        ("Government-issued photo ID", "Driver license or passport of the signing officer", 1),
        ("Formation documents", "Certificate of formation or incorporation", 1),
        ("Cap table", "Current capitalization table", 1),
        ("The contract at issue", "Signed agreement involved in the dispute", 1),
        ("Correspondence", "Relevant emails or letters with the other side", 0),
    ],
    "real_estate": [
        ("Government-issued photo ID", "Driver license or passport", 1),
        ("Lease or purchase agreement", "Signed lease or contract of sale", 1),
        ("Property deed or title report", "If you own the property", 0),
        ("Correspondence", "Emails or letters with the other party", 0),
    ],
    "ip": [
        ("Government-issued photo ID", "Driver license or passport of the owner", 1),
        ("Trademark registration or application", "Registration certificate or serial number", 1),
        ("Samples showing use of the mark", "Photos, packaging or screenshots", 0),
        ("Cease and desist letter", "Any letter you received or sent", 0),
    ],
}

INQUIRIES = [
    ("email", "Maria Santos", "maria.santos@example.com", "555-0111", "Fired after reporting unpaid overtime",
     "Hello, I was fired two weeks after I reported unpaid overtime to HR at my employer Brightwave Media Inc. in Brooklyn, New York. "
     "I worked there for four years and earned $92,000 a year. They offered no severance and said my position was eliminated, but they hired someone new last week. "
     "I think this was retaliation and I would like to talk to a lawyer about wrongful termination."),
    ("web_form", "Tom Reiner", "tom@reinerfab.example", "555-0112", "Vendor breached our supply contract",
     "My company Reiner Fabrication LLC is based in Newark, New Jersey. Our logistics vendor stopped delivering under our written contract and we lost about $85,000 in orders. "
     "We want to sue Northwind Logistics LLC for breach of contract. Please let me know if you can take this on."),
    ("email", "Kyle Brennan", "kbrennan@example.com", "555-0113", "DUI arrest last night",
     "I was arrested last night in Albany, New York for a DUI and I have a court date this week. I need a criminal defense lawyer urgently."),
    ("web_form", "Ellen Park", "ellen.park@example.com", "555-0114", "Divorce and custody",
     "I am filing for divorce in Columbus, Ohio and need help with custody of our two children and child support. Do you handle family law?"),
    ("referral", "Priya Nair", "priya@lumenanalytics.example", "555-0115", "Vendor contract breach - cloud hosting",
     "I am the CEO of Lumen Analytics Inc. in Stamford, Connecticut. Our cloud hosting vendor, Orbit Cloud Services Inc., breached our signed contract after a multi-day outage and refused to issue the agreed service credits. "
     "The credits and our losses total about $40,000 and we are considering a lawsuit."),
    ("email", "Chris Doe", "chris.doe@example.com", "", "Need a lawyer",
     "Hi, I need a lawyer ASAP. Something happened and I am not sure what to do. Please call me."),
    ("email", "James Okafor", "jokafor@crestline.example", "555-0117", "Dispute with former contractor",
     "I am general counsel of Crestline Holdings Inc. in Hartford, Connecticut. We want to sue our former contractor Bluepeak Builders LLC for breach of contract over defective work, roughly $220,000 in damages."),
    ("web_form", "Sam Whitaker", "sam@saltmarshbrewing.example", "555-0118", "Cease and desist over our brewery trademark",
     "I own a craft brewery in Hoboken, New Jersey. We got a cease and desist letter claiming our beer name infringes a trademark. We want to understand our options and possibly register our own mark."),
]


def _tok() -> str:
    return secrets.token_urlsafe(16)


def seed() -> None:
    td = date.fromisoformat(os.environ.get("DOCKETEER_TODAY") or date.today().isoformat())
    d = lambda n: (td + timedelta(days=n)).isoformat()  # noqa: E731
    ts = lambda n: f"{d(n)}T09:00:00"  # noqa: E731
    db.set_setting("today", td.isoformat())
    db.set_setting("default_rate_usd", "350")
    db.set_setting("firm_json", json.dumps(FIRM))

    rules = [("accept_area", a, "Accepted practice area") for a in ("business", "employment", "real_estate", "ip")]
    rules += [("accept_jurisdiction", j, "Admitted / practising state") for j in ("NY", "NJ", "CT")]
    rules += [("decline_area", a, "Firm does not handle this area") for a in ("criminal", "family", "immigration")]
    rules += [("min_value", "5000", "Minimum matter value in USD for litigation"),
              ("custom", "adverse_is_client", "Decline / escalate if an adverse party is an existing client")]
    for r in rules:
        db.insert("firm_rules", rule_type=r[0], value=r[1], note=r[2])
    for area, items in CHECKLISTS.items():
        for item, desc, req in items:
            db.insert("checklist_templates", practice_area=area, item=item, description=desc, required=req)

    clients = [("Northwind Logistics LLC", "company", "ops@northwind.example", "555-0201", "88 Dock Rd, Newark, NJ"),
               ("Dana Whitfield", "individual", "dana.whitfield@example.com", "555-0202", "14 Elm St, Albany, NY"),
               ("Harlow & Pine Bakery LLC", "company", "hello@harlowpine.example", "555-0203", "9 Main St, Stamford, CT"),
               ("Greenfield Dental Group", "company", "admin@greenfielddental.example", "555-0204", "41 Park Ave, New York, NY"),
               ("Marcus Teller", "individual", "marcus.teller@example.com", "555-0205", "7 Oak Ln, Hoboken, NJ")]
    cid = {c[0]: db.insert("clients", name=c[0], type=c[1], email=c[2], phone=c[3], address=c[4], created_at=ts(-90)) for c in clients}

    matters = [
        ("Dana Whitfield", "Whitfield v. Halvorsen Retail - wrongful termination", "employment", "Wrongful termination",
         "Dana was dismissed after raising wage concerns; pre-suit negotiation with her former employer.", ["Halvorsen Retail Corp."], "active"),
        ("Northwind Logistics LLC", "Northwind - Crestline contract dispute", "business", "Breach of contract",
         "Northwind claims Crestline Holdings failed to pay under a freight services agreement.", ["Crestline Holdings Inc."], "active"),
        ("Harlow & Pine Bakery LLC", "Harlow & Pine - storefront lease review", "real_estate", "Commercial lease",
         "Review and negotiation of a new storefront lease.", ["Maple Row Properties LLC"], "onboarding"),
    ]
    mid = {}
    for cn, title, area, mt, summ, adv, stage in matters:
        m = db.insert("matters", client_id=cid[cn], inquiry_id=None, title=title, practice_area=area, matter_type=mt, summary=summ,
                      adverse_parties_json=json.dumps(adv), stage=stage, portal_token=_tok(), lawyer_name=LAWYER, created_at=ts(-60), updated_at=ts(-5))
        mid[cn] = m
        for a in adv:
            db.insert("contacts", name=a, kind="adverse", matter_id=m, note="Adverse party")
        client = db.q1("SELECT * FROM clients WHERE id=?", (cid[cn],))
        terms = {"scope": summ, "fee_arrangement": "Hourly at $350 per hour.", "initial_retainer_usd": 3000,
                 "exclusions": "Appeals and tax advice are excluded."}
        md = letters.render_letter_md(FIRM, client, {"title": title, "lawyer_name": LAWYER}, terms)
        db.insert("engagement_letters", matter_id=m, terms_json=json.dumps(terms), markdown=md, status="signed", sent_at=ts(-58),
                  signed_at=ts(-56), signed_name=cn)
        db.insert("events", matter_id=m, kind="stage", text=f"Matter opened in stage {stage} (seed data)", created_at=ts(-60))
    db.insert("contacts", name="Tomas Brandt", kind="counsel", matter_id=mid["Northwind Logistics LLC"], note="tbrandt@brandtlaw.example (counsel for Crestline)")

    # Dana: verified docs + unbilled time + tasks
    dana = mid["Dana Whitfield"]
    for item, desc, req in CHECKLISTS["employment"][:4]:
        db.insert("matter_documents", matter_id=dana, item=item, description=desc, required=req, status="verified", requested_at=ts(-56),
                  uploaded_at=ts(-54), verified_at=ts(-54), original_name="seed.txt",
                  verification_json=json.dumps({"verdict": "verified", "explanation": "Seed data"}))
    for n, mins, desc in [(-12, 60, "call w/ client re: severance offer"), (-10, 150, "review employment agreement and handbook"),
                          (-8, 90, "research on retaliation claims"), (-5, 45, "tc w/ opposing counsel"), (-3, 120, "draft demand letter")]:
        db.insert("time_entries", matter_id=dana, entry_date=d(n), minutes=mins, description=desc, rate_usd=350, invoice_id=None)
    db.insert("tasks", matter_id=dana, title="Send demand letter after partner review", owner="lawyer", due_date=d(2), status="open", created_at=ts(-3))
    db.insert("tasks", matter_id=dana, title="Send last 12 months of W-2 / pay records", owner="client", due_date=d(1), status="open", created_at=ts(-3))

    # Northwind: sent invoice, 20 days overdue
    nw = mid["Northwind Logistics LLC"]
    entries = [(-60, 120, "review freight services agreement"), (-55, 90, "call w/ client re: unpaid invoices")]
    inv = db.insert("invoices", matter_id=nw, number=f"HV-{td.year}-001", status="sent", issue_date=d(-50), due_date=d(-20), subtotal_usd=0,
                    lines_json="[]", cover_email="Seed invoice", reminder_stage=0, sent_at=ts(-50))
    lines, total = [], 0.0
    for dt, mins, desc in entries:
        amt = round(mins / 60 * 350, 2)
        total += amt
        eid = db.insert("time_entries", matter_id=nw, entry_date=d(dt), minutes=mins, description=desc, rate_usd=350, invoice_id=inv)
        lines.append({"entry_id": eid, "date": d(dt), "minutes": mins, "rate_usd": 350, "narrative": desc.capitalize() + ".", "amount_usd": amt})
    db.update("invoices", inv, subtotal_usd=round(total, 2), lines_json=json.dumps(lines))
    db.insert("tasks", matter_id=nw, title="Obtain Crestline's response to demand", owner="counterparty", due_date=d(3), status="open", created_at=ts(-10))
    db.insert("events", matter_id=nw, kind="invoice", text=f"Invoice HV-{td.year}-001 sent (seed data)", created_at=ts(-50))

    # Harlow & Pine: onboarding with docs outstanding
    hp = mid["Harlow & Pine Bakery LLC"]
    for i, (item, desc, req) in enumerate(CHECKLISTS["real_estate"][:3]):
        db.insert("matter_documents", matter_id=hp, item=item, description=desc, required=req, status="verified" if i == 0 else "requested",
                  requested_at=ts(-2), uploaded_at=ts(-1) if i == 0 else None, verified_at=ts(-1) if i == 0 else None)

    for src, name, email, phone, subj, msg in INQUIRIES:
        db.insert("inquiries", received_at=ts(-1), source=src, name=name, email=email, phone=phone, subject=subj, message=msg, status="new", created_at=ts(-1))
