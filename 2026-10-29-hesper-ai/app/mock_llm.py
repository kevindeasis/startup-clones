"""Deterministic, schema-valid fake 'LLM' for running without an API key.

It derives outputs from the INPUT_JSON payload in the prompt using regexes and heuristics.
It is tuned for the bundled demo claim but degrades gracefully on arbitrary text."""
from __future__ import annotations

import json
import re
from datetime import date

from pydantic import BaseModel

from . import models as M

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DATE_RE = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})"
    r"|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})"
    r"|(\d{1,2})/(\d{1,2})/(\d{4})"
)
AMOUNT_RE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d{1,2})?)")


def parse_input(text: str) -> dict:
    i = text.index("INPUT_JSON:") + len("INPUT_JSON:")
    obj, _ = json.JSONDecoder().raw_decode(text[i:].lstrip())
    return obj


def sentences(text: str) -> list[str]:
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", line):
            if s.strip():
                out.append(s.strip())
    return out


def q(s: str) -> str:
    return s.strip()[:200]


def iso_dates(s: str) -> list[str]:
    res = []
    for m in DATE_RE.finditer(s):
        try:
            if m.group(1):
                d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            elif m.group(4):
                d = date(int(m.group(6)), MONTHS[m.group(4).lower()], int(m.group(5)))
            else:
                d = date(int(m.group(9)), int(m.group(7)), int(m.group(8)))
            res.append(d.isoformat())
        except ValueError:
            pass
    return res


def date_label(sentence: str, doc_type: str) -> str:
    low = sentence.lower()
    if doc_type == "policy" or "policy period" in low:
        return "Policy period"
    if "invoice" in low or doc_type == "invoice":
        return "Invoice date"
    if "report" in low or "statement date" in low:
        return "Report date"
    if any(k in low for k in ("loss", "accident", "incident", "occurred", "noticed", "discovered", "happened", "night of", "evening")):
        return "Date of loss"
    return "Other date"


# ---- step 2 ---------------------------------------------------------------
def facts(inp: dict) -> M.DocumentFacts:
    text, doc_type = inp.get("text", ""), inp.get("doc_type", "other")
    sents = sentences(text)
    if not text.strip():
        return M.DocumentFacts(summary=f"{inp.get('filename')}: image/empty document; no text to analyze in mock mode.")
    dates, amounts, assertions, parties = [], [], [], []
    for s in sents:
        label = date_label(s, doc_type)
        for d in iso_dates(s):
            dates.append(M.DateFact(date=d, event=f"{label} - {s[:90]}", quote=q(s)))
        for m in AMOUNT_RE.finditer(s):
            amounts.append(M.AmountFact(amount=float(m.group(1).replace(",", "")), what=s[:90], quote=q(s)))
    speaker = inp.get("claimant_name", "") if doc_type in ("statement", "fnol") else "document author"
    cands = [s for s in sents if len(s) > 30 and not s.isupper()]
    for s in cands[:10]:
        assertions.append(M.Assertion(text=s[:160], quote=q(s), speaker=speaker))
    for m in re.finditer(r"(?:Insured|Claimant|Customer|Named Insured|Taken by|Reported by)\s*:\s*([A-Z][A-Za-z.' -]+?)(?:,|\(|$|\n)", text, re.M):
        parties.append(M.Party(name=m.group(1).strip(), role=m.group(0).split(":")[0].strip().lower()))
    locs = [m.group(1).strip() for m in re.finditer(r"(?:Location|Property)\s*:\s*(.+)", text)]
    summary = f"{doc_type} document '{inp.get('filename')}' with {len(sents)} statements, {len(dates)} dated events and {len(amounts)} monetary amounts."
    return M.DocumentFacts(summary=summary, parties=parties[:6], dates=dates, amounts=amounts, assertions=assertions, locations=locs[:3])


# ---- step 3 ---------------------------------------------------------------
def timeline(inp: dict) -> M.Timeline:
    events, anomalies = [], []
    claim = inp.get("claim", {})
    loss = claim.get("loss_date") or ""
    if loss:
        events.append(M.TimelineEvent(date=loss, event="Date of loss (per claim record)", document_id="claim", quote=f"Loss date: {loss}", confidence=0.9))
    for d in inp.get("documents", []):
        for f in d.get("dates", []):
            events.append(M.TimelineEvent(date=f["date"], event=f["event"], document_id=d["document_id"], quote=f["quote"][:200], confidence=0.9 if re.match(r"\d{4}-\d\d-\d\d", f["date"]) else 0.6))
    events.sort(key=lambda e: e.date)
    loss_dates = {e.date for e in events if e.event.startswith("Date of loss")}
    if len(loss_dates) > 1:
        anomalies.append(f"Multiple different loss dates stated across the file: {', '.join(sorted(loss_dates))}.")
    for e in events:
        if e.event.startswith("Invoice date") and loss and e.date < loss:
            anomalies.append(f"Invoice dated {e.date} predates the reported loss date {loss}.")
        if e.event.startswith("Report date") and loss and e.date < loss:
            anomalies.append(f"Report dated {e.date} predates the reported loss date {loss}.")
    return M.Timeline(events=events, gaps_or_anomalies=list(dict.fromkeys(anomalies)))


# ---- step 4 ---------------------------------------------------------------
SUDDEN = ["burst pipe", "pipe burst", "sudden"]
GRADUAL = ["seep", "heavy rain", "dripping", "for weeks", "groundwater"]


def _find(docs, keys, skip_negated=False, exclude=None):
    for d in docs:
        if exclude and d["document_id"] == exclude:
            continue
        for a in d.get("assertions", []):
            low = a["quote"].lower()
            if skip_negated and (" not " in low or " no " in low):
                continue
            if any(k in low for k in keys):
                return d["document_id"], a["quote"]
    return None


def inconsistencies(inp: dict) -> M.InconsistencyReport:
    docs, claim = inp.get("documents", []), inp.get("claim", {})
    incs, corr = [], []
    # 1. loss date conflicts
    loss_cites = []
    if claim.get("loss_date"):
        loss_cites.append(("claim", claim["loss_date"], f"Loss date: {claim['loss_date']}"))
    for d in docs:
        for f in d.get("dates", []):
            if f["event"].startswith("Date of loss"):
                loss_cites.append((d["document_id"], f["date"], f["quote"]))
    base = loss_cites[0] if loss_cites else None
    for c in loss_cites[1:]:
        if base and c[1] != base[1]:
            incs.append(M.Inconsistency(
                title=f"Loss date conflict ({base[1]} vs {c[1]})", severity="high",
                claim_a=M.Citation(document_id=base[0], quote=base[2][:200]),
                claim_b=M.Citation(document_id=c[0], quote=c[2][:200]),
                explanation=f"One source places the loss on {base[1]} while another places it on {c[1]}."))
            break
    # 2. documents dated before loss
    loss = claim.get("loss_date") or ""
    for d in docs:
        for f in d.get("dates", []):
            if f["event"].startswith("Invoice date") and loss and f["date"] < loss:
                incs.append(M.Inconsistency(
                    title="Invoice dated before the reported loss", severity="high",
                    claim_a=M.Citation(document_id="claim", quote=f"Loss date: {loss}"),
                    claim_b=M.Citation(document_id=d["document_id"], quote=f["quote"][:200]),
                    explanation=f"The invoice is dated {f['date']} but the reported loss date is {loss}; work billed before the loss occurred is a red flag."))
                break
    # 3. cause of loss
    a = _find(docs, SUDDEN, skip_negated=True)
    b = _find(docs, GRADUAL, exclude=a[0] if a else None)
    if a and b:
        incs.append(M.Inconsistency(
            title="Cause of loss differs between documents", severity="high",
            claim_a=M.Citation(document_id=a[0], quote=a[1]), claim_b=M.Citation(document_id=b[0], quote=b[1]),
            explanation="One document describes a sudden pipe failure; another describes water seeping in after rain, which is a materially different cause."))
    # 4. estimate vs invoice total
    est = inv = None
    for d in docs:
        for am in d.get("amounts", []):
            low = am["what"].lower()
            if "estimat" in low and est is None:
                est = (d["document_id"], am)
            if ("total" in low or "amount due" in low) and inv is None:
                inv = (d["document_id"], am)
    if est and inv and est[0] != inv[0] and inv[1]["amount"] > est[1]["amount"] * 1.25:
        incs.append(M.Inconsistency(
            title="Invoice total far exceeds initial damage estimate", severity="medium",
            claim_a=M.Citation(document_id=est[0], quote=est[1]["quote"]), claim_b=M.Citation(document_id=inv[0], quote=inv[1]["quote"]),
            explanation=f"Estimated damage was ${est[1]['amount']:,.2f} but the invoice totals ${inv[1]['amount']:,.2f}."))
    # corroborations: same name in several docs
    names: dict[str, list[str]] = {}
    for d in docs:
        for p in d.get("parties", []):
            names.setdefault(p["name"], []).append(d["document_id"])
    for n, ids in names.items():
        if len(set(ids)) > 1:
            corr.append(M.Corroboration(fact=f"{n} appears in multiple documents", document_ids=sorted(set(ids))))
    return M.InconsistencyReport(inconsistencies=incs, corroborations=corr[:5])


# ---- step 5 ---------------------------------------------------------------
GROUPS = {
    "seepage": ["seep", "leak", "drip"],
    "water intrusion": ["flood", "surface water", "groundwater", "rain", "foundation"],
    "wear": ["wear", "tear", "rust", "corrosion"],
}


def coverage(inp: dict) -> M.CoveragePosition:
    clauses, trig_claim, trig_other = [], [], []
    desc = (inp.get("loss_description") or "").lower()
    other = " ".join(inp.get("fact_quotes", [])).lower()
    for p in inp.get("policies", []):
        for s in sentences(p["text"]):
            low = s.lower()
            if re.search(r"do not cover|not cover|exclu", low):
                eff = "excludes"
            elif re.search(r"limit|deductible", low):
                eff = "limits"
            elif re.search(r"must|duties|condition", low):
                eff = "condition"
            elif re.search(r"\bwe cover\b|insured against", low):
                eff = "grants"
            else:
                continue
            if eff == "excludes":
                for g, terms in GROUPS.items():
                    if any(t in low for t in terms):
                        if any(t in desc for t in terms):
                            trig_claim.append((g, s))
                        elif any(t in other for t in terms):
                            trig_other.append((g, s))
            clauses.append(M.Clause(clause_quote=s[:300], document_id=p["document_id"], effect=eff))
    clauses = [c for c in clauses if c.effect != "condition"][:8] + [c for c in clauses if c.effect == "condition"][:1]
    if trig_claim:
        g, s = trig_claim[0]
        return M.CoveragePosition(position="not_covered", clauses=clauses, rationale=f"The stated loss involves {g}, which the policy excludes: \"{s[:160]}\"",
                                  open_questions=["Does any document support a sudden and accidental discharge that would fall under the insuring clause?"])
    if trig_other:
        g, s = trig_other[0]
        return M.CoveragePosition(position="unclear", clauses=clauses, rationale=f"Statements in the file suggest {g}, which the policy excludes, but the claim description does not state it.",
                                  open_questions=["Reconcile the cause of loss across documents."])
    if any(c.effect == "grants" for c in clauses):
        return M.CoveragePosition(position="covered", clauses=clauses, rationale="No exclusion matched the described loss and an insuring clause appears to apply.", open_questions=[])
    return M.CoveragePosition(position="unclear", clauses=clauses, rationale="Policy text did not clearly grant or exclude the described loss.", open_questions=["Obtain the full policy form."])


# ---- step 6 ---------------------------------------------------------------
SEV = {"info": 0, "low": 3, "medium": 8, "high": 15}


def risk(inp: dict) -> M.RiskAssessment:
    score, why = 0, []
    for f in inp.get("forensics", []):
        pts = SEV.get(f["severity"], 0)
        if pts:
            score += pts
            why.append(f"Forensics ({f['severity']}): {f['flag']} - {f['detail'][:120]}")
    for i in inp.get("inconsistencies", []):
        score += SEV[i["severity"]]
        why.append(f"Inconsistency ({i['severity']}): {i['title']}")
    cov = inp.get("coverage", {}).get("position", "unclear")
    score += {"not_covered": 15, "partially_covered": 8, "unclear": 5, "covered": 0}[cov]
    if cov != "covered":
        why.append(f"Coverage position is '{cov}'.")
    for a in inp.get("timeline_anomalies", []):
        score += 5
        why.append(f"Timeline anomaly: {a}")
    score = max(0, min(100, score))
    band = M.band_for(score)
    acts = []
    if any(i["severity"] == "high" for i in inp.get("inconsistencies", [])):
        acts.append(M.RecommendedAction(action="Re-interview the claimant to resolve the conflicting loss date and cause of loss", priority="now", why="High-severity inconsistencies between sworn/recorded statements and the FNOL."))
    if any(f["severity"] in ("medium", "high") for f in inp.get("forensics", [])):
        acts.append(M.RecommendedAction(action="Request original native files from the issuer of flagged documents and verify directly with the vendor", priority="now", why="Forensic flags indicate documents may have been altered after creation."))
    if cov in ("not_covered", "partially_covered", "unclear"):
        acts.append(M.RecommendedAction(action="Issue a reservation of rights and send the file to coverage counsel", priority="soon", why=f"Coverage position is '{cov}'."))
    acts.append(M.RecommendedAction(action="Inspect the loss site and document the source of water with photos", priority="soon", why="Physical evidence is needed to establish the cause of loss."))
    acts.append(M.RecommendedAction(action="Refer to SIU if risk band remains high after re-interview", priority="later", why="Standard escalation path for elevated fraud indicators."))
    summ = (f"Automated review of the claim file produced a risk score of {score}/100 ({band}). "
            f"{len(inp.get('inconsistencies', []))} inconsistencies, {sum(1 for f in inp.get('forensics', []) if f['severity'] != 'info')} forensic flags and a coverage position of '{cov}' were identified. "
            + ("Key concern: " + inp["inconsistencies"][0]["title"] + ". " if inp.get("inconsistencies") else "")
            + "All findings are cited to source documents in this evidence file; no conclusions beyond the documents are drawn.")
    return M.RiskAssessment(score=score, band=band, rationale=why[:12] or ["No material findings."], recommended_actions=acts, executive_summary=summ)


def generate(schema: type[BaseModel], prompt_text: str) -> dict:
    inp = parse_input(prompt_text)
    fn = {M.DocumentFacts: facts, M.Timeline: timeline, M.InconsistencyReport: inconsistencies,
          M.CoveragePosition: coverage, M.RiskAssessment: risk}[schema]
    return fn(inp).model_dump()
