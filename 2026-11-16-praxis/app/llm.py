"""LLM layer. One function per agent step; each returns a pydantic model and logs an agent_runs row.

Live mode: anthropic.Anthropic().messages.parse(..., output_format=<model>) -> response.parsed_output.
Mock mode (MOCK_LLM=1 or no ANTHROPIC_API_KEY): MockLLM returns deterministic keyword-rule outputs
through exactly the same public functions.
"""
import json
import os
import re
import time
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from . import db
from .conflicts import normalize
from .prompts import system_prompt, user_prompt

DEFAULT_MODEL = "claude-opus-5-5"


def is_mock() -> bool:
    return bool(os.environ.get("MOCK_LLM", "").strip() in ("1", "true", "yes")) or not os.environ.get("ANTHROPIC_API_KEY", "").strip()


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL


# ----------------------------- structured output models -----------------------------
class Party(BaseModel):
    name: str
    role: Literal["client", "adverse", "other"]


class InquiryExtract(BaseModel):
    practice_area: Literal["business", "employment", "real_estate", "ip", "litigation", "family", "criminal", "immigration", "other"]
    matter_type: str
    summary: str = Field(description="Two sentences")
    client_type: Literal["individual", "company"]
    parties: list[Party]
    jurisdiction: str = Field(description="Two-letter US state code or 'unknown'")
    urgency: Literal["low", "normal", "high"]
    estimated_value_usd: int | None
    questions_for_client: list[str] = Field(description="At most 3")


class EmailDraft(BaseModel):
    subject: str
    body: str
    rationale: str


class EngagementTerms(BaseModel):
    scope: str
    fee_arrangement: str
    initial_retainer_usd: int
    exclusions: str


class ExtraItem(BaseModel):
    item: str
    reason: str


class ChecklistExtras(BaseModel):
    items: list[ExtraItem] = Field(description="At most 2 extra document requests")


class DocVerification(BaseModel):
    doc_type_detected: str
    matches_requested: bool
    names_found: list[str]
    dates_found: list[str]
    expiry_date: str | None
    issues: list[str]
    verdict: Literal["verified", "mismatch", "expired", "unreadable", "needs_lawyer"]
    explanation: str


class NarrativeLine(BaseModel):
    entry_id: int
    narrative: str


class InvoiceNarrative(BaseModel):
    lines: list[NarrativeLine]
    subject: str
    body: str
    rationale: str


# ----------------------------- live client + dispatcher -----------------------------
_client = None


def get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    return _client


def _run(agent: str, task: str, ctx: dict, model_cls, effort: str, matter_id=None, inquiry_id=None):
    system = system_prompt(task, matter_id, inquiry_id)
    user = user_prompt(ctx)
    t0 = time.time()
    if is_mock():
        mode, model = "mock", "mock"
        out = getattr(MockLLM, agent)({**ctx, "firm": db.firm()})
        in_tok, out_tok = (len(system) + len(user)) // 4, len(out.model_dump_json()) // 4
    else:
        mode, model = "live", model_name()
        resp = get_client().messages.parse(
            model=model, max_tokens=4096, system=system,
            messages=[{"role": "user", "content": user}],
            output_format=model_cls, output_config={"effort": effort},
        )
        out = resp.parsed_output
        in_tok, out_tok = resp.usage.input_tokens, resp.usage.output_tokens
    db.insert("agent_runs", agent=agent, matter_id=matter_id, inquiry_id=inquiry_id, mode=mode, model=model,
              input_tokens=in_tok, output_tokens=out_tok, duration_ms=int((time.time() - t0) * 1000),
              prompt=f"[system]\n{system}\n[user]\n{user}", output=out.model_dump_json(indent=2), created_at=db.now())
    return out


# ----------------------------- public agent steps -----------------------------
def extract_inquiry(inquiry: dict) -> InquiryExtract:
    ctx = {"inquiry": {k: inquiry.get(k) for k in ("name", "email", "phone", "subject", "message", "source")}}
    out = _run("extract_inquiry", "Extract structured intake data from this inbound inquiry. Do not decide whether to accept it.",
               ctx, InquiryExtract, "low", inquiry_id=inquiry.get("id"))
    out.questions_for_client = out.questions_for_client[:3]
    return out


def draft_reply(inquiry: dict, extract: dict, decision: str, reasons: list[str], times: list[str]) -> EmailDraft:
    ctx = {"inquiry": {k: inquiry.get(k) for k in ("name", "email", "subject", "message")}, "extract": extract,
           "decision": decision, "internal_reasons_do_not_disclose": reasons, "proposed_consult_times": times}
    task = {"accept": "Draft a warm reply proposing a 20-minute consult at exactly the two proposed times and listing what to prepare.",
            "decline": "Draft a polite decline that includes the bar referral line verbatim. No legal advice. Do not disclose internal reasons.",
            "needs_lawyer": "Draft a holding reply saying a partner will review within one business day. Do not disclose internal reasons."}[decision]
    return _run("draft_reply", task, ctx, EmailDraft, "medium", inquiry_id=inquiry.get("id"))


def draft_engagement_terms(inquiry: dict, extract: dict) -> EngagementTerms:
    ctx = {"extract": extract, "default_rate_usd": db.get_setting("default_rate_usd")}
    return _run("draft_engagement_terms", "Fill scope, fee_arrangement, initial_retainer_usd and exclusions for an engagement letter. Fixed clauses are template text; write only these four fields.",
                ctx, EngagementTerms, "medium", inquiry_id=inquiry.get("id"))


def suggest_checklist_extras(matter: dict, existing_items: list[str]) -> ChecklistExtras:
    ctx = {"practice_area": matter["practice_area"], "summary": matter["summary"], "existing_items": existing_items}
    out = _run("suggest_checklist_extras", "Suggest at most 2 extra documents to request, each with a one-line reason, not duplicating existing items.",
               ctx, ChecklistExtras, "low", matter_id=matter["id"])
    out.items = out.items[:2]
    return out


def verify_document(matter: dict, doc: dict, client_names: list[str], filename: str, text: str, is_image: bool, note: str) -> DocVerification:
    ctx = {"requested_item": doc["item"], "requested_description": doc["description"], "client_names": client_names,
           "filename": filename, "client_description": note, "is_image_no_ocr": is_image, "today": db.today().isoformat(),
           "document_text": text[:8000]}
    return _run("verify_document", "Verify an uploaded client document against the requested item. Report what it is, names, dates, expiry and a verdict.",
                ctx, DocVerification, "low", matter_id=matter["id"])


def draft_document_request(matter: dict, client: dict, items: list[dict], portal_url: str) -> EmailDraft:
    ctx = {"client": client["name"], "matter": matter["title"], "items": [{"item": i["item"], "description": i["description"]} for i in items], "portal_url": portal_url}
    return _run("draft_document_request", "Draft an email asking the client to upload the listed documents through the portal link.", ctx, EmailDraft, "medium", matter_id=matter["id"])


def draft_chaser(matter: dict, client: dict, kind: str, chase_no: int, docs: list[dict], tasks: list[dict], portal_url: str, to_name: str | None = None) -> EmailDraft:
    ctx = {"recipient_kind": kind, "recipient": to_name or client["name"], "matter": matter["title"], "chase_number": chase_no,
           "outstanding_documents": [d["item"] for d in docs], "overdue_tasks": [{"title": t["title"], "due": t["due_date"]} for t in tasks], "portal_url": portal_url}
    task = ("Draft a follow-up email. Tone by chase_number: 1 friendly, 2 direct, 3 or more must say work on the matter is paused until items arrive. "
            "For recipient_kind 'counterparty' use a neutral, professional tone and never threaten legal action.")
    return _run("draft_chaser", task, ctx, EmailDraft, "medium", matter_id=matter["id"])


def draft_status_update(matter: dict, client: dict, portal_url: str) -> EmailDraft:
    ctx = {"client": client["name"], "matter": matter["title"], "event": "onboarding complete, all documents verified", "portal_url": portal_url}
    return _run("draft_status_update", "Draft a status update: onboarding is complete and explain in general terms what happens next.", ctx, EmailDraft, "medium", matter_id=matter["id"])


def draft_invoice_narrative(matter: dict, client: dict, entries: list[dict], number: str, total: float, due_date: str) -> InvoiceNarrative:
    ctx = {"client": client["name"], "matter": matter["title"], "invoice_number": number, "total_usd": total, "due_date": due_date,
           "entries": [{"entry_id": e["id"], "date": e["entry_date"], "minutes": e["minutes"], "description": e["description"]} for e in entries]}
    return _run("draft_invoice_narrative", "Rewrite each time entry description as a client-friendly narrative line (keep entry_id; never change minutes or amounts) and draft the invoice cover email.",
                ctx, InvoiceNarrative, "medium", matter_id=matter["id"])


def draft_payment_reminder(matter: dict, client: dict, invoice: dict, days_overdue: int, stage: int, portal_url: str) -> EmailDraft:
    ctx = {"client": client["name"], "matter": matter["title"], "invoice_number": invoice["number"], "amount_usd": invoice["subtotal_usd"],
           "due_date": invoice["due_date"], "days_overdue": days_overdue, "stage": stage, "portal_url": portal_url}
    task = "Draft a payment reminder. Stage 1 friendly, stage 2 firm, stage 3 final notice mentioning that work may be paused. Never threaten legal action."
    return _run("draft_payment_reminder", task, ctx, EmailDraft, "medium", matter_id=matter["id"])


# ----------------------------- mock implementation -----------------------------
STATES = {"new york": "NY", "new jersey": "NJ", "connecticut": "CT", "ohio": "OH", "california": "CA", "texas": "TX",
          "florida": "FL", "pennsylvania": "PA", "massachusetts": "MA", "illinois": "IL", "georgia": "GA", "michigan": "MI",
          "virginia": "VA", "washington": "WA", "colorado": "CO", "arizona": "AZ", "nevada": "NV", "maryland": "MD"}
STOP_LEAD = {"The", "My", "Our", "We", "I", "Hi", "Hello", "Dear", "At", "After", "Because", "Please", "Since", "When", "Last", "For", "With", "By", "If", "And", "But", "Sue", "Against"}
COMPANY_RE = re.compile(r"\b((?:[A-Z][A-Za-z0-9&'\-]*\s+){1,3}(?:Inc|LLC|Corp|Ltd|Co)\b\.?)")
PERSON_RE = re.compile(r"(?:\bvs\.?|\bagainst|\bversus|my employer|my landlord|\bsue|\bsuing)\s+([A-Z][\w'-]+(?:\s[A-Z][\w'-]+){0,2})")
CLIENT_BEFORE = re.compile(r"((my|our)\s+(company|business|firm|startup)|we are|on behalf of|i run|i own|(ceo|founder|counsel|president|owner|director|manager|cfo|coo)\s+(of|for|at))\s*$")
ADVERSE_BEFORE = re.compile(r"(against|\bvs\.?|versus|\bsue\b|suing|employer|vendor|supplier|landlord|contractor|dispute with|contract with|breach)")
ADVERSE_AFTER = re.compile(r"(breach|owes|failed|refused|stopped paying|fired|terminated)")
KINDS = [
    ("id", r"driver|licen[sc]e|passport|government[- ]issued|identification|\bid card\b|photo id|state id"),
    ("termination_letter", r"termination|separation notice|laid off|employment (is|has been) (ended|terminated)"),
    ("employment_agreement", r"employment agreement|offer letter|employment contract"),
    ("pay_stub", r"pay stub|paystub|earnings statement|gross pay|net pay|payslip|pay period"),
    ("complaint", r"complaint|grievance|hr report"),
    ("formation", r"certificate of (formation|incorporation)|articles of (organization|incorporation)|formation"),
    ("cap_table", r"cap table|capitalization"),
    ("deed", r"\bdeed\b|title (report|insurance)"),
    ("contract", r"agreement|contract|statement of work|lease"),
    ("correspondence", r"correspondence|email|e-mail"),
]
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
US_DATE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")


def _kind(s: str) -> str:
    s = s.lower()
    for k, rx in KINDS:
        if re.search(rx, s):
            return k
    return "other"


def _email(subject: str, body: str, rationale: str) -> EmailDraft:
    return EmailDraft(subject=subject, body=body.strip(), rationale=rationale)


def _bullets(items) -> str:
    return "\n".join(f"- {i}" for i in items)


class MockLLM:
    """Deterministic keyword-rule stand-in for the live model. Same inputs/outputs as the live path."""

    @staticmethod
    def extract_inquiry(ctx):
        inq = ctx["inquiry"]
        text = f"{inq.get('subject') or ''}. {inq.get('message') or ''}"
        low = text.lower()
        if re.search(r"arrested|\bdui\b|criminal|felony|misdemeanor|charged with", low):
            area, mt = "criminal", "Criminal defense"
        elif re.search(r"divorce|custody|child support|alimony", low):
            area, mt = "family", "Divorce / custody"
        elif re.search(r"visa|green card|immigration|deport", low):
            area, mt = "immigration", "Immigration"
        elif re.search(r"fired|terminated (me|my employment)|wrongful|harass|discriminat|severance|retaliat|laid off|unpaid wages|hostile work", low):
            area = "employment"
            mt = ("Wrongful termination / retaliation" if re.search(r"fired|wrongful|retaliat|terminated", low)
                  else "Workplace harassment" if "harass" in low else "Employment dispute")
        elif re.search(r"trademark|patent|copyright|cease and desist|infring", low):
            area, mt = "ip", "Trademark / IP dispute"
        elif re.search(r"landlord|tenant|lease|eviction|\bdeed\b|closing on|real estate|zoning", low):
            area, mt = "real_estate", "Real estate / lease"
        elif re.search(r"contract|vendor|breach|shareholder|partnership|operating agreement|supplier", low):
            area = "business"
            mt = "Breach of contract" if "breach" in low else "Shareholder / commercial matter"
            if re.search(r"\bsue\b|lawsuit|litigat", low):
                mt += " (litigation)"
        else:
            area, mt = "other", "Unclear - needs clarification"

        # jurisdiction: earliest state name / abbreviation
        best = None
        for nm, code in STATES.items():
            i = low.find(nm)
            if i >= 0 and (best is None or i < best[0]):
                best = (i, code)
        for m in re.finditer(r"\b(NY|NJ|CT|OH|CA|TX|FL|PA|MA)\b", text):
            if best is None or m.start() < best[0]:
                best = (m.start(), m.group(1))
        jurisdiction = best[1] if best else "unknown"

        # parties
        parties, seen = [], set()

        def add(name, role):
            name = name.strip().rstrip(".").strip()
            key = normalize(name)
            if name and key and key not in seen:
                seen.add(key)
                parties.append({"name": name, "role": role})

        client_company = None
        for m in COMPANY_RE.finditer(text):
            words = m.group(1).split()
            while words and words[0] in STOP_LEAD:
                words.pop(0)
            if len(words) < 2:
                continue
            name = " ".join(words)
            before = text[max(0, m.start() - 45):m.start()].lower()
            after = text[m.end():m.end() + 40].lower()
            if CLIENT_BEFORE.search(before):
                role = "client"
                client_company = client_company or name
            elif ADVERSE_BEFORE.search(before[-35:]) or ADVERSE_AFTER.search(after):
                role = "adverse"
            else:
                role = "other"
            add(name, role)
        for m in PERSON_RE.finditer(text):
            add(m.group(1), "adverse")
        if not any(p["role"] == "client" for p in parties):
            parties.insert(0, {"name": inq.get("name") or "Unknown", "role": "client"})
        client_type = "company" if client_company else "individual"

        amounts = []
        for m in re.finditer(r"\$\s?([\d,]+(?:\.\d+)?)\s?(k|K|million|m)?", text):
            v = float(m.group(1).replace(",", "") or 0)
            v *= {"k": 1e3, "K": 1e3, "million": 1e6, "m": 1e6}.get((m.group(2) or ""), 1)
            amounts.append(int(v))
        urgency = "high" if re.search(r"urgent|asap|immediately|deadline|tomorrow|court date|this week|arraign", low) else "normal"
        qs = {
            "employment": ["When did your employment end, and what reason were you given?", "Do you have an employment agreement, offer letter or handbook?", "Did you report any concerns in writing before the termination?"],
            "business": ["Can you share the contract or agreement at issue?", "What outcome are you hoping for?", "Have you already sent or received any formal notices?"],
            "real_estate": ["What is the property address and your role (owner, tenant, buyer)?", "Is there a lease or purchase agreement?", "Are there any deadlines coming up?"],
            "ip": ["What mark or invention is involved and is it registered?", "Have you received any letters from the other side?", "When did you first use the mark?"],
        }.get(area, ["Can you tell us more about what happened?", "What outcome are you hoping for?", "Are there any deadlines coming up?"])
        first = re.split(r"(?<=[.!?])\s+", (inq.get("message") or "").strip())[0][:200]
        summary = f"{inq.get('name') or 'The sender'} contacted the firm about a possible {mt.lower()} matter. They wrote: \"{first}\""
        return InquiryExtract(practice_area=area, matter_type=mt, summary=summary, client_type=client_type,
                              parties=[Party(**p) for p in parties], jurisdiction=jurisdiction, urgency=urgency,
                              estimated_value_usd=max(amounts) if amounts else None, questions_for_client=qs[:3])

    @staticmethod
    def draft_reply(ctx):
        f, inq, ex = ctx["firm"], ctx["inquiry"], ctx["extract"]
        first = (inq.get("name") or "there").split()[0]
        sign = f"Kind regards,\n{f['name']}\n{f['phone']}"
        subj = f"Re: {inq.get('subject') or 'your inquiry'}"
        if ctx["decision"] == "accept":
            t = ctx["proposed_consult_times"]
            body = (f"Hello {first},\n\nThank you for contacting {f['name']} about your {ex['matter_type'].lower()} matter. "
                    f"This looks like something our team can help with, and we would like to offer a free 20-minute consult.\n\n"
                    f"Two times that work on our side:\n{_bullets(t)}\n\nTo make the call productive, please have ready:\n"
                    f"{_bullets(ex['questions_for_client'] + ['Any documents you already have (contracts, letters, emails)'])}\n\n"
                    f"Reply with the time that suits you. We will send the consult invitation once you confirm.\n\n{sign}")
            return _email(subj, body, "Matter fits the firm's accepted practice areas and jurisdictions; proposed the next available consult slots.")
        if ctx["decision"] == "decline":
            body = (f"Hello {first},\n\nThank you for reaching out to {f['name']}. After reviewing your message, "
                    f"we are unable to take on this matter because it falls outside the types of matters our firm handles.\n\n"
                    f"{f['bar_referral_line']}\n\nPlease note that time limits can apply to legal matters, so we encourage you to contact another lawyer soon. "
                    f"This email is not legal advice.\n\n{sign}")
            return _email(subj, body, "Firm rules say we do not handle this matter; polite decline with the bar referral line.")
        body = (f"Hello {first},\n\nThank you for contacting {f['name']}. We have received your message, and a partner will review within one business day "
                f"whether we are able to help. We will follow up with next steps after that review.\n\n{sign}")
        return _email(subj, body, "Needs a partner's review before any commitment (see internal screening notes).")

    @staticmethod
    def draft_engagement_terms(ctx):
        ex, area = ctx["extract"], ctx["extract"]["practice_area"]
        rate = ctx.get("default_rate_usd") or "350"
        retainer = {"employment": 3000, "business": 5000, "real_estate": 2500, "ip": 2500}.get(area, 3000)
        scope = (f"The Firm will advise the Client in connection with: {ex['matter_type']}. {ex['summary']} "
                 f"Work includes reviewing the Client's documents, advising on options, and communicating with the other side as the Client authorises.")
        return EngagementTerms(
            scope=scope,
            fee_arrangement=f"The Firm bills hourly at ${rate} per hour for lawyer time. Costs such as filing fees are billed at cost.",
            initial_retainer_usd=retainer,
            exclusions="This engagement does not include appeals, tax advice, or any matter outside the scope above unless agreed in writing.")

    @staticmethod
    def suggest_checklist_extras(ctx):
        low, have = (ctx["summary"] or "").lower(), " ".join(ctx["existing_items"]).lower()
        cands = []
        if "severance" in low:
            cands.append(("Severance or separation offer", "You mentioned a severance discussion; we need the written terms."))
        if re.search(r"wage|overtime|commission", low):
            cands.append(("Wage or commission records", "Needed to check the pay issues you described."))
        if re.search(r"retaliat|report", low):
            cands.append(("Your written report or complaint to HR", "Shows when and how the concern was raised."))
        if re.search(r"shareholder|partner", low):
            cands.append(("Shareholder or operating agreement", "Governs the dispute you described."))
        if re.search(r"vendor|breach|contract|sue", low):
            cands.append(("Invoices or purchase orders related to the dispute", "Helps document the amounts in question."))
        if re.search(r"trademark|infring|cease", low):
            cands.append(("Samples showing how the mark is used", "Needed to assess the mark's use in commerce."))
        if not cands:
            cands.append(("A short written timeline of events", "Helps the lawyer prepare for your first meeting."))
        out = [ExtraItem(item=i, reason=r) for i, r in cands if i.lower() not in have][:2]
        return ChecklistExtras(items=out)

    @staticmethod
    def verify_document(ctx):
        text, fn, item = ctx["document_text"], ctx["filename"], ctx["requested_item"]
        today = date.fromisoformat(ctx["today"])
        if ctx["is_image_no_ocr"]:
            return DocVerification(doc_type_detected="image (not machine-read)", matches_requested=True, names_found=[], dates_found=[],
                                   expiry_date=None, issues=["Images are not read automatically (no OCR)."], verdict="needs_lawyer",
                                   explanation="Image received; only the filename and your description were available, so a lawyer will review it.")
        if not text.strip():
            return DocVerification(doc_type_detected="unknown", matches_requested=False, names_found=[], dates_found=[], expiry_date=None,
                                   issues=["No text could be extracted from the file."], verdict="unreadable",
                                   explanation="We could not read any text in this file.")
        ik, tk = _kind(item), _kind(text[:2000] + " " + fn)
        if ik != "other":
            matches = tk == ik
        else:
            toks = [t for t in re.findall(r"[a-z]{4,}", item.lower())]
            matches = any(t in (text + fn + (ctx.get("client_description") or "")).lower() for t in toks) if toks else True
        names = []
        for line in text.splitlines():
            m = re.match(r"(?i)^\s*(?:name|employee|holder|issued to|client|full name)\s*[:\-]\s*(.+?)\s*$", line)
            if m:
                names.append(m.group(1))
            elif re.fullmatch(r"[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}", line.strip()):
                names.append(line.strip())
        dates = ISO_DATE.findall(text) + [f"{y}-{int(mo):02d}-{int(d):02d}" for mo, d, y in US_DATE.findall(text)]
        expiry = None
        m = re.search(r"(?i)(?:expires?|expiry|expiration(?: date)?)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4})", text)
        if m:
            v = m.group(1)
            if "/" in v:
                mo, d, y = v.split("/")
                v = f"{y}-{int(mo):02d}-{int(d):02d}"
            expiry = v
        issues, verdict, expl = [], "verified", f"Looks like the requested document ({item})."
        if not matches:
            verdict, issues, expl = "mismatch", [f"Document does not look like: {item}"], f"This does not appear to be the requested item ({item})."
        elif expiry and date.fromisoformat(expiry) < today:
            verdict, issues, expl = "expired", [f"Expired on {expiry}"], f"This document expired on {expiry}."
        return DocVerification(doc_type_detected="government_id" if tk == "id" else tk, matches_requested=matches, names_found=names,
                               dates_found=sorted(set(dates)), expiry_date=expiry, issues=issues, verdict=verdict, explanation=expl)

    @staticmethod
    def draft_document_request(ctx):
        f = ctx["firm"]
        items = [f"{i['item']} ({i['description']})" if i["description"] else i["item"] for i in ctx["items"]]
        body = (f"Hello {ctx['client'].split()[0]},\n\nWelcome aboard. To get started on {ctx['matter']}, please upload the following through your secure client portal:\n\n"
                f"{_bullets(items)}\n\nPortal link: {ctx['portal_url']}\n\nPDF, text, PNG or JPG files up to 10 MB are fine. If something is hard to find, tell us in the note field and we will help.\n\n"
                f"Kind regards,\n{f['name']}")
        return _email(f"Documents we need for {ctx['matter']}", body, "Engagement letter signed; checklist built from the firm template plus intake-specific extras.")

    @staticmethod
    def draft_chaser(ctx):
        f, n, kind = ctx["firm"], ctx["chase_number"], ctx["recipient_kind"]
        first = ctx["recipient"].split()[0]
        docs, tasks = ctx["outstanding_documents"], ctx["overdue_tasks"]
        lines = list(docs) + [f"{t['title']} (due {t['due']})" for t in tasks]
        sign = f"Kind regards,\n{f['name']}"
        if kind == "counterparty":
            body = (f"Dear {first},\n\nWe are following up regarding {ctx['matter']}. The following items remain outstanding:\n\n{_bullets(lines)}\n\n"
                    f"We would appreciate an update at your earliest convenience.\n\n{sign}")
            return _email(f"Follow-up: {ctx['matter']}", body, "Neutral follow-up on overdue counterparty items.")
        link = f"\n\nPortal link: {ctx['portal_url']}"
        if n <= 1:
            body = f"Hello {first},\n\nA friendly reminder: we are still waiting on a few items for {ctx['matter']}:\n\n{_bullets(lines)}{link}\n\nThank you!\n\n{sign}"
            tone = "friendly first reminder"
        elif n == 2:
            body = f"Hello {first},\n\nWe still need the following for {ctx['matter']} and have not yet received them:\n\n{_bullets(lines)}{link}\n\nPlease send them this week so we can keep your matter moving.\n\n{sign}"
            tone = "direct second reminder"
        else:
            body = (f"Hello {first},\n\nThese items for {ctx['matter']} are still outstanding:\n\n{_bullets(lines)}{link}\n\n"
                    f"Because we cannot proceed without them, work on your matter is paused until they arrive. Please reply if you need help.\n\n{sign}")
            tone = "third reminder, flags matter is paused"
        return _email(f"Reminder ({n}): items needed for {ctx['matter']}", body, f"Outstanding items past the chase threshold; {tone}.")

    @staticmethod
    def draft_status_update(ctx):
        f = ctx["firm"]
        body = (f"Hello {ctx['client'].split()[0]},\n\nGood news: all of your onboarding documents for {ctx['matter']} have been received and verified, "
                f"so your matter is now active. A lawyer will be in touch with next steps, and you can follow progress in your portal: {ctx['portal_url']}\n\n"
                f"Kind regards,\n{f['name']}")
        return _email(f"Onboarding complete: {ctx['matter']}", body, "All required documents verified; matter moves to active once approved.")

    @staticmethod
    def draft_invoice_narrative(ctx):
        f = ctx["firm"]
        reps = [(r"\bw/\b", "with"), (r"\bre:?\s", "regarding "), (r"\btc\b", "telephone conference"), (r"\bmtg\b", "meeting"),
                (r"\bdocs\b", "documents"), (r"\bpls?\b", "pleadings"), (r"\bresch?\b", "research"), (r"\bdraft\b", "drafting")]
        lines = []
        for e in ctx["entries"]:
            d = e["description"].strip()
            for rx, rp in reps:
                d = re.sub(rx, rp, d, flags=re.I)
            d = d[:1].upper() + d[1:]
            lines.append(NarrativeLine(entry_id=e["entry_id"], narrative=d if d.endswith(".") else d + "."))
        body = (f"Hello {ctx['client'].split()[0]},\n\nPlease find attached invoice {ctx['invoice_number']} for ${ctx['total_usd']:,.2f} covering recent work on {ctx['matter']}. "
                f"Payment is due by {ctx['due_date']}. You can view the invoice and pay online in your client portal.\n\nThank you,\n{f['name']}")
        return InvoiceNarrative(lines=lines, subject=f"Invoice {ctx['invoice_number']} from {f['name']}", body=body,
                                rationale=f"{len(lines)} time entries rewritten for clarity; totals computed in code from minutes and rates.")

    @staticmethod
    def draft_payment_reminder(ctx):
        f, st = ctx["firm"], ctx["stage"]
        first = ctx["client"].split()[0]
        ref = f"invoice {ctx['invoice_number']} (${ctx['amount_usd']:,.2f}, due {ctx['due_date']}, {ctx['days_overdue']} days past due)"
        link = f"You can pay online here: {ctx['portal_url']}"
        sign = f"Kind regards,\n{f['name']}"
        if st <= 1:
            body, tone = f"Hello {first},\n\nA quick reminder that {ref} is still open. If you have already paid, thank you and please disregard this note. {link}\n\n{sign}", "friendly"
        elif st == 2:
            body, tone = f"Hello {first},\n\nOur records show {ref} remains unpaid. Please arrange payment this week or contact us to discuss a payment plan. {link}\n\n{sign}", "firm"
        else:
            body, tone = (f"Hello {first},\n\nThis is a final notice for {ref}. Unless we receive payment or hear from you, we may need to pause work on {ctx['matter']}. {link}\n\n{sign}"), "final notice"
        return _email(f"Payment reminder: invoice {ctx['invoice_number']}", body, f"Stage {st} reminder ({tone}); invoice {ctx['days_overdue']} days overdue.")
