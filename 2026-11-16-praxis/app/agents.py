"""Approvals (the one rule), onboarding, daily agents (chasers, reminders) and billing."""
import json
import re
import secrets
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from pypdf import PdfReader
from rapidfuzz import fuzz

from . import db, letters, llm

OUTSTANDING = ("requested", "mismatch", "expired", "unreadable")
REMINDER_THRESHOLDS = {1: 7, 2: 14, 3: 30}
ALLOWED_EXT = {".pdf", ".txt", ".md", ".png", ".jpg", ".jpeg"}
MAX_UPLOAD = 10 * 1024 * 1024


class AppError(Exception):
    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status


def money(x) -> Decimal:
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def d10(s: str) -> date:
    return date.fromisoformat(s[:10])


def portal_url(matter: dict) -> str:
    return f"{db.base_url()}/portal/{matter['portal_token']}"


def get_matter(mid: int) -> dict:
    m = db.q1("SELECT * FROM matters WHERE id=?", (mid,))
    if not m:
        raise AppError("matter not found", 404)
    return m


def get_client(m: dict) -> dict:
    return db.q1("SELECT * FROM clients WHERE id=?", (m["client_id"],))


def set_stage(mid: int, stage: str) -> None:
    db.run("UPDATE matters SET stage=?, updated_at=? WHERE id=?", (stage, db.now(), mid))
    db.log_event(mid, "stage", f"Stage changed to {stage}")


def send_mail(matter_id, to_email, subject, body, kind, attachment=None) -> int:
    """The ONLY place that writes to outbox; called solely from approve()."""
    oid = db.insert("outbox", matter_id=matter_id, to_email=to_email, subject=subject, body=body, attachment_path=attachment, kind=kind, sent_at=db.now())
    db.log_event(matter_id, "outbox", f"Sent '{subject}' to {to_email}")
    return oid


def create_approval(type_: str, title: str, draft_text: str, subject: str | None, to_email: str | None, rationale: str,
                    payload: dict, matter_id=None, inquiry_id=None) -> int:
    aid = db.insert("approvals", type=type_, matter_id=matter_id, inquiry_id=inquiry_id, title=title, draft_text=draft_text, subject=subject,
                    to_email=to_email, rationale=rationale, payload_json=json.dumps(payload), status="pending", created_at=db.now())
    db.log_event(matter_id, "approval", f"Agent drafted {type_} for approval: {title}")
    return aid


def get_approval(aid: int) -> dict:
    a = db.q1("SELECT * FROM approvals WHERE id=?", (aid,))
    if not a:
        raise AppError("approval not found", 404)
    a["payload"] = json.loads(a["payload_json"] or "{}")
    return a


# ----------------------------- approve / reject -----------------------------
def approve(aid: int, draft_text: str | None = None, subject: str | None = None) -> dict:
    a = get_approval(aid)
    if a["status"] != "pending":
        raise AppError(f"approval already {a['status']}", 409)
    text = draft_text if draft_text is not None and draft_text.strip() else a["draft_text"]
    subj = subject if subject else a["subject"]
    p, t, mid = a["payload"], a["type"], a["matter_id"]
    out = {}
    if t == "engagement_letter":
        mid = _exec_engagement_letter(a, text)
        out["matter_id"] = mid
    else:
        send_mail(mid, a["to_email"], subj, text, "chaser_counterparty" if p.get("kind") == "counterparty" else t, None)
        if t == "document_request":
            for did in p.get("doc_ids", []):
                db.run("UPDATE matter_documents SET requested_at=? WHERE id=?", (db.now(), did))
        elif t == "chaser":
            for did in p.get("doc_ids", []):
                db.run("UPDATE matter_documents SET last_chased_at=?, chase_count=chase_count+1 WHERE id=?", (db.now(), did))
            for tid in p.get("task_ids", []):
                db.run("UPDATE tasks SET last_chased_at=? WHERE id=?", (db.now(), tid))
        elif t == "status_update" and p.get("kind") == "onboarding_complete":
            set_stage(mid, "active")
        elif t == "invoice_email":
            db.run("UPDATE invoices SET status='sent', sent_at=?, cover_email=? WHERE id=?", (db.now(), text, p["invoice_id"]))
            db.log_event(mid, "invoice", "Invoice sent to client")
    db.run("UPDATE approvals SET status='approved', draft_text=?, subject=?, matter_id=?, decided_at=? WHERE id=?", (text, subj, mid, db.now(), aid))
    db.log_event(mid, "approval", f"Lawyer approved {t}: {a['title']}")
    return {"id": aid, "status": "approved", **out}


def reject(aid: int, reason: str) -> dict:
    if not reason or not reason.strip():
        raise AppError("a rejection reason is required")
    a = get_approval(aid)
    if a["status"] != "pending":
        raise AppError(f"approval already {a['status']}", 409)
    p = a["payload"]
    if a["type"] == "invoice_email":
        db.run("UPDATE invoices SET status='void' WHERE id=?", (p["invoice_id"],))
        db.run("UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=?", (p["invoice_id"],))
    elif a["type"] == "payment_reminder":
        inv = db.q1("SELECT reminder_stage FROM invoices WHERE id=?", (p["invoice_id"],))
        if inv and inv["reminder_stage"] == p["stage"]:
            db.run("UPDATE invoices SET reminder_stage=? WHERE id=?", (p["stage"] - 1, p["invoice_id"]))
    db.run("UPDATE approvals SET status='rejected', reject_reason=?, decided_at=? WHERE id=?", (reason.strip(), db.now(), aid))
    db.log_event(a["matter_id"], "approval", f"Lawyer rejected {a['type']}: {reason.strip()}")
    return {"id": aid, "status": "rejected"}


def _exec_engagement_letter(a: dict, text: str) -> int:
    p = a["payload"]
    c = p["client"]
    row = db.q1("SELECT id FROM clients WHERE lower(name)=lower(?) AND lower(email)=lower(?)", (c["name"], c["email"] or ""))
    cid = row["id"] if row else db.insert("clients", name=c["name"], type=c["type"], email=c["email"], phone=c.get("phone"), address=None, created_at=db.now())
    m = p["matter"]
    mid = db.insert("matters", client_id=cid, inquiry_id=a["inquiry_id"], title=m["title"], practice_area=m["practice_area"], matter_type=m["matter_type"],
                    summary=m["summary"], adverse_parties_json=json.dumps(m["adverse"]), stage="engagement_sent",
                    portal_token=secrets.token_urlsafe(16), lawyer_name=m["lawyer_name"], created_at=db.now(), updated_at=db.now())
    for n in m["adverse"]:
        db.insert("contacts", name=n, kind="adverse", matter_id=mid, note="Adverse party from intake")
    docx = letters.save_letter(mid, text)
    db.insert("engagement_letters", matter_id=mid, terms_json=json.dumps(p["terms"]), markdown=text, docx_path=docx, status="sent", sent_at=db.now())
    if a["inquiry_id"]:
        db.run("UPDATE inquiries SET status='converted' WHERE id=?", (a["inquiry_id"],))
    db.log_event(mid, "stage", "Matter created in stage engagement_sent")
    matter = get_matter(mid)
    body = (f"Hello {c['name'].split()[0]},\n\nPlease find our engagement letter attached. You can review and sign it online here: {portal_url(matter)}\n\n"
            f"Kind regards,\n{db.firm()['name']}")
    send_mail(mid, c["email"], f"Engagement letter: {m['title']}", body, "engagement_letter", docx)
    return mid


# ----------------------------- onboarding -----------------------------
def sign_letter(token: str, name: str, agree) -> dict:
    m = db.q1("SELECT * FROM matters WHERE portal_token=?", (token,))
    if not m:
        raise AppError("portal not found", 404)
    letter = db.q1("SELECT * FROM engagement_letters WHERE matter_id=? ORDER BY id DESC", (m["id"],))
    if not letter or letter["status"] != "sent":
        raise AppError("no engagement letter is waiting for a signature", 409)
    if str(agree).lower() not in ("1", "true", "on", "yes"):
        raise AppError("please tick the confirmation box")
    if not name or len(name.strip()) < 3:
        raise AppError("please type your full name")
    db.run("UPDATE engagement_letters SET status='signed', signed_at=?, signed_name=? WHERE id=?", (db.now(), name.strip(), letter["id"]))
    db.log_event(m["id"], "letter", f"Engagement letter signed by {name.strip()}")
    set_stage(m["id"], "onboarding")
    client = get_client(m)
    ids = []
    templates = db.q("SELECT * FROM checklist_templates WHERE practice_area=? ORDER BY id", (m["practice_area"],))
    for t in templates:
        ids.append(db.insert("matter_documents", matter_id=m["id"], item=t["item"], description=t["description"], required=t["required"], status="requested", requested_at=db.now()))
    extras = llm.suggest_checklist_extras(m, [t["item"] for t in templates]).items[:2]
    for e in extras:
        ids.append(db.insert("matter_documents", matter_id=m["id"], item=e.item, description=e.reason, required=0, status="requested", requested_at=db.now()))
    docs = db.q(f"SELECT * FROM matter_documents WHERE id IN ({','.join('?' * len(ids))})", tuple(ids)) if ids else []
    draft = llm.draft_document_request(m, client, docs, portal_url(m))
    aid = create_approval("document_request", f"Document request: {m['title']}", draft.body, draft.subject, client["email"], draft.rationale,
                          {"doc_ids": ids}, matter_id=m["id"])
    db.insert("tasks", matter_id=m["id"], title="Review checklist and schedule kick-off call", owner="lawyer", due_date=db.add_days(db.today(), 2).isoformat(), status="open", created_at=db.now())
    return {"stage": "onboarding", "documents": len(ids), "approval_id": aid}


def _client_message(verdict: str, expl: str, issues: list[str]) -> str:
    detail = expl or "; ".join(issues)
    return {"verified": "Received, verified",
            "mismatch": f"We need a clearer copy: {detail}",
            "expired": f"We need an up-to-date copy: {detail}",
            "unreadable": f"We need a clearer copy: {detail}",
            "needs_lawyer": "Received, a lawyer will review this file"}.get(verdict, "Received")


def process_upload(token: str, document_id: int, filename: str, data: bytes, note: str) -> dict:
    m = db.q1("SELECT * FROM matters WHERE portal_token=?", (token,))
    if not m:
        raise AppError("portal not found", 404)
    doc = db.q1("SELECT * FROM matter_documents WHERE id=? AND matter_id=?", (document_id, m["id"]))
    if not doc:
        raise AppError("document request not found", 404)
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise AppError(f"unsupported file type {ext or '(none)'}; allowed: pdf, txt, md, png, jpg")
    if len(data) > MAX_UPLOAD:
        raise AppError("file is larger than 10 MB", 413)
    safe = re.sub(r"[^\w.\-]", "_", Path(filename).name)
    dest = db.upload_dir() / str(m["id"]) / f"{doc['id']}_{safe}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    is_image = ext in (".png", ".jpg", ".jpeg")
    text = ""
    if ext == ".pdf":
        try:
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(str(dest)).pages)
        except Exception:
            text = ""
    elif not is_image:
        text = data.decode("utf-8", errors="replace")
    client = get_client(m)
    names = [client["name"]]
    if m["inquiry_id"]:
        inq = db.q1("SELECT name FROM inquiries WHERE id=?", (m["inquiry_id"],))
        if inq and inq["name"]:
            names.append(inq["name"])
    res = llm.verify_document(m, doc, names, safe, text, is_image, note or "")
    verdict, issues = res.verdict, list(res.issues)
    # deterministic post-checks
    if verdict != "unreadable" and not is_image:
        if res.expiry_date:
            try:
                if date.fromisoformat(res.expiry_date) < db.today():
                    verdict = "expired"
                    issues.append(f"Expired on {res.expiry_date}")
            except ValueError:
                pass
        is_id = res.doc_type_detected == "government_id" or re.search(r"\bid\b|passport|licen[sc]e", doc["item"].lower())
        if is_id and not any(fuzz.token_set_ratio(n.lower(), c.lower()) >= 80 for n in res.names_found for c in names):
            verdict = "mismatch"
            issues.append("Name on the ID does not match the client name")
    expl = res.explanation
    if verdict != res.verdict:
        expl = "; ".join(issues)
    vj = {**res.model_dump(), "verdict": verdict, "issues": issues, "explanation": expl, "client_message": _client_message(verdict, expl, issues)}
    now = db.now()
    db.run("UPDATE matter_documents SET status=?, file_path=?, original_name=?, client_note=?, verification_json=?, uploaded_at=?, verified_at=? WHERE id=?",
           (verdict, str(dest), filename, note, json.dumps(vj), now, now if verdict == "verified" else None, doc["id"]))
    db.log_event(m["id"], "document", f"'{doc['item']}' uploaded: {verdict}")
    approval = check_onboarding_complete(m["id"])
    return {"status": verdict, "message": vj["client_message"], "verification": vj, "status_update_approval_id": approval}


def check_onboarding_complete(mid: int) -> int | None:
    m = get_matter(mid)
    if m["stage"] != "onboarding":
        return None
    req = db.q("SELECT status FROM matter_documents WHERE matter_id=? AND required=1", (mid,))
    if not req or any(r["status"] != "verified" for r in req):
        return None
    for a in db.q("SELECT payload_json FROM approvals WHERE matter_id=? AND type='status_update' AND status IN ('pending','approved')", (mid,)):
        if json.loads(a["payload_json"]).get("kind") == "onboarding_complete":
            return None
    client = get_client(m)
    draft = llm.draft_status_update(m, client, portal_url(m))
    return create_approval("status_update", f"Onboarding complete: {m['title']}", draft.body, draft.subject, client["email"], draft.rationale,
                           {"kind": "onboarding_complete"}, matter_id=mid)


def lawyer_verify_doc(doc_id: int) -> dict:
    doc = db.q1("SELECT * FROM matter_documents WHERE id=?", (doc_id,))
    if not doc:
        raise AppError("document not found", 404)
    db.run("UPDATE matter_documents SET status='verified', verified_at=? WHERE id=?", (db.now(), doc_id))
    db.log_event(doc["matter_id"], "document", f"Lawyer marked '{doc['item']}' as verified")
    return {"status": "verified", "status_update_approval_id": check_onboarding_complete(doc["matter_id"])}


# ----------------------------- daily agents -----------------------------
def _pending_chaser(mid: int, kind: str) -> bool:
    return any(json.loads(a["payload_json"]).get("kind") == kind for a in db.q("SELECT payload_json FROM approvals WHERE matter_id=? AND type='chaser' AND status='pending'", (mid,)))


def _chase_no(mid: int, kind: str) -> int:
    return 1 + sum(1 for a in db.q("SELECT payload_json FROM approvals WHERE matter_id=? AND type='chaser' AND status='approved'", (mid,))
                   if json.loads(a["payload_json"]).get("kind") == kind)


def run_daily() -> dict:
    today = db.today()
    n = db.chase_after_days()
    chasers, reminders, statuses = [], [], []
    for m in db.q("SELECT * FROM matters WHERE stage IN ('onboarding','active') ORDER BY id"):
        mid, client = m["id"], get_client(m)
        statuses.append(check_onboarding_complete(mid)) if m["stage"] == "onboarding" else None
        # client chaser: outstanding documents + overdue client tasks (one email per matter)
        docs = db.q(f"SELECT * FROM matter_documents WHERE matter_id=? AND status IN ({','.join('?' * len(OUTSTANDING))}) ORDER BY id", (mid, *OUTSTANDING))
        tasks = [t for t in db.q("SELECT * FROM tasks WHERE matter_id=? AND status='open' AND owner='client' AND due_date IS NOT NULL", (mid,))
                 if (today - d10(t["due_date"])).days >= 2]
        due_docs = [d for d in docs if (today - d10(d["last_chased_at"] or d["requested_at"] or today.isoformat())).days >= n]
        due_tasks = [t for t in tasks if not t["last_chased_at"] or (today - d10(t["last_chased_at"])).days >= n]
        if (due_docs or due_tasks) and not _pending_chaser(mid, "client"):
            no = _chase_no(mid, "client")
            dr = llm.draft_chaser(m, client, "client", no, docs, tasks, portal_url(m))
            chasers.append(create_approval("chaser", f"Chaser #{no}: {m['title']}", dr.body, dr.subject, client["email"], dr.rationale,
                                           {"kind": "client", "doc_ids": [d["id"] for d in docs], "task_ids": [t["id"] for t in tasks], "chase_no": no}, matter_id=mid))
        # counterparty chaser
        ctasks = [t for t in db.q("SELECT * FROM tasks WHERE matter_id=? AND status='open' AND owner='counterparty' AND due_date IS NOT NULL", (mid,))
                  if (today - d10(t["due_date"])).days >= 2 and (not t["last_chased_at"] or (today - d10(t["last_chased_at"])).days >= n)]
        if ctasks and not _pending_chaser(mid, "counterparty"):
            counsel = db.q1("SELECT * FROM contacts WHERE matter_id=? AND kind='counsel' ORDER BY id", (mid,))
            to_name = counsel["name"] if counsel else "Counsel"
            to_email = (re.search(r"[\w.+-]+@[\w.-]+", counsel["note"] or "") or [None])[0] if counsel else None
            no = _chase_no(mid, "counterparty")
            dr = llm.draft_chaser(m, client, "counterparty", no, [], ctasks, portal_url(m), to_name=to_name)
            chasers.append(create_approval("chaser", f"Counterparty follow-up: {m['title']}", dr.body, dr.subject, to_email or "counterparty@example.invalid", dr.rationale,
                                           {"kind": "counterparty", "doc_ids": [], "task_ids": [t["id"] for t in ctasks], "chase_no": no}, matter_id=mid))
    for inv in db.q("SELECT * FROM invoices WHERE status='sent' ORDER BY id"):
        days = (today - d10(inv["due_date"])).days
        target = max([s for s, thr in REMINDER_THRESHOLDS.items() if days >= thr], default=0)
        if target > inv["reminder_stage"]:
            m = get_matter(inv["matter_id"])
            client = get_client(m)
            dr = llm.draft_payment_reminder(m, client, inv, days, target, portal_url(m))
            db.run("UPDATE invoices SET reminder_stage=? WHERE id=?", (target, inv["id"]))
            reminders.append(create_approval("payment_reminder", f"Payment reminder (stage {target}): {inv['number']}", dr.body, dr.subject, client["email"], dr.rationale,
                                             {"invoice_id": inv["id"], "stage": target}, matter_id=m["id"]))
    return {"today": today.isoformat(), "chasers": chasers, "payment_reminders": reminders, "status_updates": [s for s in statuses if s]}


# ----------------------------- billing -----------------------------
def generate_invoice(mid: int) -> dict:
    m = get_matter(mid)
    client = get_client(m)
    entries = db.q("SELECT * FROM time_entries WHERE matter_id=? AND invoice_id IS NULL ORDER BY entry_date,id", (mid,))
    if not entries:
        raise AppError("no unbilled time entries on this matter")
    today = db.today()
    count = db.q1("SELECT COUNT(*) c FROM invoices WHERE number LIKE ?", (f"HV-{today.year}-%",))["c"]
    number = f"HV-{today.year}-{count + 1:03d}"
    subtotal = money(sum(Decimal(e["minutes"]) * Decimal(str(e["rate_usd"])) / Decimal(60) for e in entries))
    due = db.add_days(today, db.invoice_net_days()).isoformat()
    nar = llm.draft_invoice_narrative(m, client, entries, number, float(subtotal), due)
    by_id = {ln.entry_id: ln.narrative for ln in nar.lines}
    lines = [{"entry_id": e["id"], "date": e["entry_date"], "minutes": e["minutes"], "rate_usd": e["rate_usd"],
              "narrative": by_id.get(e["id"]) or e["description"], "amount_usd": float(money(Decimal(e["minutes"]) * Decimal(str(e["rate_usd"])) / 60))} for e in entries]
    iid = db.insert("invoices", matter_id=mid, number=number, status="draft", issue_date=today.isoformat(), due_date=due, subtotal_usd=float(subtotal),
                    lines_json=json.dumps(lines), cover_email=nar.body, reminder_stage=0)
    db.run(f"UPDATE time_entries SET invoice_id=? WHERE id IN ({','.join('?' * len(entries))})", (iid, *[e["id"] for e in entries]))
    aid = create_approval("invoice_email", f"Invoice {number}: {m['title']}", nar.body, nar.subject, client["email"], nar.rationale,
                          {"invoice_id": iid}, matter_id=mid)
    db.log_event(mid, "invoice", f"Invoice {number} drafted (${subtotal})")
    return {"invoice_id": iid, "number": number, "subtotal_usd": float(subtotal), "status": "draft", "approval_id": aid}


def pay_invoice(token: str, invoice_id: int) -> dict:
    m = db.q1("SELECT * FROM matters WHERE portal_token=?", (token,))
    if not m:
        raise AppError("portal not found", 404)
    inv = db.q1("SELECT * FROM invoices WHERE id=? AND matter_id=?", (invoice_id, m["id"]))
    if not inv:
        raise AppError("invoice not found", 404)
    if inv["status"] != "sent":
        raise AppError(f"invoice is {inv['status']} and cannot be paid", 409)
    db.run("UPDATE invoices SET status='paid', paid_at=? WHERE id=?", (db.now(), invoice_id))
    db.log_event(m["id"], "invoice", f"Invoice {inv['number']} paid (simulated payment)")
    return {"invoice_id": invoice_id, "status": "paid"}
