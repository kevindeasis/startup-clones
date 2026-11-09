"""LLM pipeline (findings, triage, letter) plus deterministic mock analyzers."""
import re
from urllib.parse import urlparse

from . import llm, rulebook
from .capture import PRICE_RE, seconds
from .models import AnalysisResult, Finding, Letter, TriageResult

CATEGORY_DEFS = """Categories:
- hidden_fee: mandatory fees not in the advertised price, added late in checkout (drip pricing).
- cancellation_obstacle: cancelling is harder than signing up (must call, no cancel button, etc.).
- undisclosed_renewal: auto-renewal / recurring-charge terms hidden, small, or shown only after card entry.
- fake_urgency: countdown timers that reset, stock counts that never change, fabricated scarcity.
- misleading_ad: advertised terms contradicted by checkout or contract terms.
- other: anything else deceptive."""

# default rulebook mapping for the mock analyzer
ELEMENTS = {
    "hidden_fee": ["junkfee_total_price", "ftc5_representation", "ftc5_material"],
    "cancellation_obstacle": ["rosca_simple_cancel", "ftc5_representation"],
    "undisclosed_renewal": ["rosca_disclosure", "rosca_consent", "ftc5_material"],
    "fake_urgency": ["urgency_false_scarcity", "ftc5_likely_to_mislead"],
    "misleading_ad": ["ftc5_representation", "ftc5_likely_to_mislead", "ftc5_material"],
    "other": ["ftc5_representation"],
}

# a "fee" line with an amount on the same line or on the next line (flex/table layouts split them)
FEE_LINE_RE = re.compile(r"^[^\n]*\bfees?\b(?:[^\n]*\$\d[^\n]*|[^\n]*\n\s*\$\d[\d,]*(?:\.\d{2})?)", re.I | re.M)
RENEW_RE = re.compile(r"^.*\brenews?\b.*$", re.I | re.M)
CANCEL_PHONE_RE = re.compile(r"call|phone|1-800", re.I)
CANCEL_BUTTON_RE = re.compile(r"cancel (my )?(subscription|membership|plan)|click to cancel|cancel online|"
                              r"\[cancel\]|end subscription", re.I)
CANCEL_LINE_RE = re.compile(r"^.*\b(call|1-800)\b.*$", re.I | re.M)


def _by_kind(evidence: list[dict]) -> dict[str, dict]:
    out = {}
    for e in evidence:
        out.setdefault(e["kind"], e)
    return out


def _amount_cents(s: str) -> int:
    return round(float(s.replace("$", "").replace(",", "")) * 100)


# ---------------------------------------------------------------- mock analysis
def mock_business(evidence: list[dict], target_url: str) -> str:
    title = ((evidence[0].get("meta") or {}).get("title") or "") if evidence else ""
    title = re.split(r"\s+[—–|]\s+|\s+-\s+", title)[0].strip()
    if title:
        return title
    host = urlparse(target_url).hostname or "Unknown"
    return host.removeprefix("www.")


def mock_analyze(evidence: list[dict], target_url: str) -> AnalysisResult:
    k = _by_kind(evidence)
    landing, recheck = k.get("landing"), k.get("landing_recheck")
    checkout, cancel, terms = k.get("checkout"), k.get("cancel"), k.get("terms")
    ltext = (landing or {}).get("text_excerpt", "")
    findings: list[Finding] = []
    harm = 0

    def add(cat, sev, conf, title, summary, quote, kind):
        findings.append(Finding(category=cat, severity=sev, confidence=conf, title=title, summary=summary,
                                quote=quote.strip(), evidence_kind=kind, legal_elements=ELEMENTS[cat]))

    if checkout:
        ctext = checkout["text_excerpt"]
        fee_lines = [re.sub(r"\s+", " ", m.group(0)).strip() for m in FEE_LINE_RE.finditer(ctext)]
        fee_lines = [l for l in fee_lines if l not in ltext]
        fee_lines = [l for l in fee_lines if PRICE_RE.search(l)]
        if fee_lines:
            for l in fee_lines:
                harm += sum(_amount_cents(a) for a in PRICE_RE.findall(l))
            add("hidden_fee", "high", 0.9, "Mandatory fees added only at checkout",
                f"{len(fee_lines)} mandatory fee line(s) appear at checkout that are not shown on the landing page: "
                + "; ".join(fee_lines) + ".", fee_lines[0], "checkout")
        rl = RENEW_RE.findall(ctext)
        if rl:
            add("undisclosed_renewal", "high", 0.85, "Auto-renewal terms shown on the checkout page in fine print",
                "Recurring-charge terms appear on the checkout page; the renewal text is not part of the advertised "
                "offer and sits below the card-entry fields.", rl[0], "checkout")
    if cancel:
        xtext = cancel["text_excerpt"]
        if CANCEL_PHONE_RE.search(xtext) and not CANCEL_BUTTON_RE.search(xtext):
            m = CANCEL_LINE_RE.search(xtext)
            quote = (m.group(0) if m else CANCEL_PHONE_RE.search(xtext).group(0)).strip()
            add("cancellation_obstacle", "high", 0.9, "Cancellation requires a phone call",
                "The account page offers no online cancellation mechanism; the consumer must phone during limited hours.",
                quote, "cancel")
    if landing and recheck:
        lt, rt = landing["meta"].get("timers", []), recheck["meta"].get("timers", [])
        stock_l, stock_r = landing["meta"].get("stock", []), recheck["meta"].get("stock", [])
        samples = landing["meta"].get("timer_samples", [])
        parts, quote, reset = [], "", False
        # Signal 1 (same page open): first timer value increases between consecutive samples.
        prev = None
        for smp in samples:
            if not smp["timers"]:
                continue
            if prev and seconds(smp["timers"][0]) > seconds(prev["timers"][0]):
                parts.append(f"timer went {prev['timers'][0]} -> {smp['timers'][0]} at t+{smp['t']:g}s "
                             f"while the page stayed open")
                quote, reset = f"Sale ends in {prev['timers'][0]}", True
                break
            prev = smp
        # Signal 2 (reload): a real countdown drops ~3s+; allow 1s jitter.
        if lt and rt and seconds(rt[0]) >= seconds(lt[0]) - 1:
            parts.append(f"on reload the timer read {rt[0]} versus {lt[0]} at first capture (it did not count down)")
            quote = quote or (f"Sale ends in {lt[0]}" if f"Sale ends in {lt[0]}" in ltext else lt[0])
            reset = True
        static_stock = bool(stock_l) and stock_l == stock_r
        if static_stock:
            parts.append(f"stock claim '{stock_l[0]}' was identical in both captures")
            quote = quote or stock_l[0]
        if reset or static_stock:
            add("fake_urgency", "high" if reset else "medium", 0.9 if reset else 0.6,
                "Urgency claims appear fabricated", "; ".join(parts)[0].upper() + "; ".join(parts)[1:] + ".",
                quote, "landing")
    if landing:
        m = re.search(r"^.*no (hidden|early payoff) fees.*$", ltext, re.I | re.M)
        if m:
            contra = None
            if terms:
                contra = re.search(r"^.*(early payoff fee|\$\d[\d,.]*\s+early).*$", terms["text_excerpt"], re.I | re.M)
            if contra:
                add("misleading_ad", "high", 0.85, "Ad promises no fees; terms impose a fee",
                    f"Landing page claims: \"{m.group(0).strip()}\" but the terms state: \"{contra.group(0).strip()}\".",
                    m.group(0), "landing")
                for a in PRICE_RE.findall(contra.group(0)):
                    harm += _amount_cents(a)
            elif checkout and any(f.category == "hidden_fee" for f in findings):
                add("misleading_ad", "high", 0.8, "Ad promises no hidden fees; checkout adds fees",
                    f"Landing page claims: \"{m.group(0).strip()}\" yet checkout adds mandatory fees.",
                    m.group(0), "landing")
    business = mock_business(evidence, target_url)
    n = len(findings)
    priority = "P1" if harm >= 100000 else "P2" if (harm >= 10000 or n >= 3) else "P3" if n else "P4"
    summary = (f"Automated first-pass review of {business}: {n} potential violation(s) identified "
               f"({', '.join(sorted({f.category for f in findings})) or 'none'}). Estimated consumer harm per "
               f"transaction ${harm / 100:,.2f}. [mock analyzer]")
    return AnalysisResult(business=business, summary=summary, harm_estimate_cents=harm,
                          priority=priority, findings=findings)


STOP = {"I", "The", "They", "He", "She", "It", "We", "My", "A", "An", "This", "That", "When", "After", "Then"}
VERBS = r"(?:charged|billed|overcharged|refused|wouldn't|won't|kept|took|sold|signed|enrolled|made|told|added|hid|never)"


def mock_triage(text: str) -> TriageResult:
    low = text.lower()
    amounts = [_amount_cents(a) for a in PRICE_RE.findall(text)]
    harm = sum(amounts)
    if re.search(r"\bfees?\b|surcharge|hidden|extra charge|added at checkout", low):
        cat = "hidden_fee"
    elif re.search(r"cancel|call to|unsubscribe", low):
        cat = "cancellation_obstacle"
    elif re.search(r"renew|auto-?pay|recurring|subscription|membership", low):
        cat = "undisclosed_renewal"
    elif re.search(r"timer|countdown|only \d+ left|urgen|sale ends", low):
        cat = "fake_urgency"
    elif re.search(r"\bads?\b|advertis|promised|misleading|bait", low):
        cat = "misleading_ad"
    else:
        cat = "other"
    name = "Unknown"
    run = r"(?:[A-Z][\w&'-]*\.?)(?:\s+(?:[A-Z][\w&'-]*\.?|&|and))*"
    m = re.search(rf"({run})\s+{VERBS}\b", text)
    if m and m.group(1).strip() not in STOP:
        name = m.group(1).strip()
    else:
        for m in re.finditer(run, text):
            cand = m.group(0).strip()
            if cand not in STOP and cand.split()[0] not in STOP:
                name = cand
                break
    if name != "Unknown":
        name = " ".join(w for w in name.split() if w not in STOP) or "Unknown"
    prio = "P1" if harm >= 100000 else "P2" if harm >= 25000 else "P3" if harm >= 2000 else "P4"
    first = re.split(r"(?<=[.!?])\s+", text.strip())[0][:240]
    summary = (f"Consumer alleges a {cat.replace('_', ' ')} issue involving {name}"
               f"{f' with about ${harm / 100:,.2f} in reported harm' if harm else ''}. "
               f"Reported: \"{first}\" Recommend first-pass review of the business's site and checkout flow.")
    return TriageResult(business=name, category=cat, harm_estimate_cents=harm, priority=prio, summary=summary)


def mock_letter(case: dict) -> str:
    biz = case["business"] or "Business"
    lines = [
        "[AGENCY]", "[DATE]", "",
        f"To: {biz}", f"Re: Notice of potential consumer-protection violations — {case['target_url']}", "",
        f"Dear {biz},", "",
        "[AGENCY] has conducted a preliminary review of your website and identified the practices described "
        "below. This letter is a formal notice and request for a written response.", "",
    ]
    for i, f in enumerate(case["findings"], 1):
        ev = next((e for e in case["evidence"] if e["id"] == f["evidence_id"]), None)
        els = [rulebook.get(x) for x in f["legal_elements"]]
        lines += [
            f"{i}. {f['title']} ({f['category'].replace('_', ' ')}, severity {f['severity']})",
            f"   {f['summary']}",
            f"   Quoted text: \"{f['quote']}\"",
            (f"   Evidence: #{ev['id']} ({ev['kind']}, captured {ev['captured_at']}, HTML SHA-256 "
             f"{ev['html_sha256']}, screenshot SHA-256 {ev['screenshot_sha256']})") if ev else "   Evidence: see case file",
            "   Legal elements implicated: " + "; ".join(f"{e['law']} - {e['element']}" for e in els if e),
            "",
        ]
    lines += [
        "Please respond within [30] days describing the corrective steps you have taken, including disclosure of "
        "total prices up front, clear disclosure of renewal terms before billing information is collected, and a "
        "simple means of cancellation. Failure to respond may result in further enforcement action.", "",
        "Sincerely,", "[AGENCY] Consumer Protection Division", "",
        "DRAFT — for attorney review",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- LLM pipeline
def _system_findings() -> str:
    return ("You are a consumer-protection investigator assisting a government regulator. You review captured web "
            "evidence (screenshots' extracted text, timer/stock readings, prices) and identify possible violations.\n\n"
            f"{CATEGORY_DEFS}\n\nRulebook (cite ONLY these ids in legal_elements):\n{rulebook.prompt_text()}\n\n"
            "Rules: quote text VERBATIM from the evidence; give confidence 0-1; set evidence_kind to the kind of "
            "evidence the quote comes from; only report issues supported by the evidence; estimate harm_estimate_cents "
            "as the per-consumer dollar harm in cents; priority P1 (urgent) to P4 (low). This is a demo, not legal advice.")


def _user_findings(evidence: list[dict], target_url: str) -> str:
    parts = [f"Target URL: {target_url}\n"]
    for e in evidence:
        m = e.get("meta", {})
        parts.append(
            f"=== EVIDENCE kind={e['kind']} url={e['url']} captured_at={e['captured_at']} ===\n"
            f"timer strings seen: {m.get('timers')}\nstock claims: {m.get('stock')}\nprices: {m.get('prices')}\n"
            f"timer_samples (same page kept open, t = seconds since first capture): {m.get('timer_samples')}\n"
            f"page title: {m.get('title')}\n--- text ---\n{e['text_excerpt'][:6000]}\n")
    parts.append("Note: landing_recheck is a fresh reload captured after the sampling window; compare timers and stock claims; a timer value that increases between consecutive timer_samples while the page stays open is a reset.")
    return "\n".join(parts)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def sanitize(result: AnalysisResult, evidence: list[dict]) -> AnalysisResult:
    """Enforce rulebook ids, and lower confidence when a quote is not verbatim in the evidence."""
    valid = rulebook.valid_ids()
    corpus = " ".join(_norm(e["text_excerpt"]) for e in evidence)
    kinds = {e["kind"] for e in evidence}
    out = []
    for f in result.findings:
        ids = [i for i in f.legal_elements if i in valid] or ELEMENTS[f.category]
        conf = f.confidence if _norm(f.quote) in corpus else min(f.confidence, 0.4)
        kind = f.evidence_kind if f.evidence_kind in kinds else next(iter(kinds), "")
        out.append(f.model_copy(update={"legal_elements": ids, "confidence": conf, "evidence_kind": kind}))
    return result.model_copy(update={"findings": out})


def analyze_case(evidence: list[dict], target_url: str) -> AnalysisResult:
    if llm.is_mock():
        return mock_analyze(evidence, target_url)
    res = llm.complete_json(_system_findings(), _user_findings(evidence, target_url), AnalysisResult)
    return sanitize(res, evidence)


def triage_complaint(text: str) -> TriageResult:
    if llm.is_mock():
        return mock_triage(text)
    system = ("You triage consumer complaints for a consumer-protection agency. Extract business (name as written, "
              "or 'Unknown'), category, harm_estimate_cents (consumer's stated monetary harm in cents), "
              "priority P1-P4 (P1 = large/widespread/vulnerable victims) and a two-sentence first-pass summary.\n"
              + CATEGORY_DEFS)
    return llm.complete_json(system, f"Complaint:\n{text}", TriageResult, max_tokens=1024)


def draft_letter(case: dict) -> str:
    if llm.is_mock():
        return mock_letter(case)
    system = ("You draft formal warning letters for a consumer-protection agency. Write ~250-400 words, addressed to "
              "the business, citing each finding, the evidence IDs and SHA-256 hashes, and the legal elements it "
              "implicates. Use placeholders [AGENCY] and [DATE]. Neutral, factual tone; no threats beyond "
              "noting possible further action. End with the exact line: DRAFT — for attorney review")
    facts = [f"Business: {case['business']}\nURL: {case['target_url']}\n"]
    for f in case["findings"]:
        ev = next((e for e in case["evidence"] if e["id"] == f["evidence_id"]), None)
        els = [rulebook.get(x) for x in f["legal_elements"]]
        facts.append(
            f"Finding: {f['title']} [{f['category']}, {f['severity']}]\n  {f['summary']}\n  Quote: \"{f['quote']}\"\n"
            + (f"  Evidence #{ev['id']} {ev['kind']} captured {ev['captured_at']} html_sha256={ev['html_sha256']} "
               f"screenshot_sha256={ev['screenshot_sha256']}\n" if ev else "")
            + "  Elements: " + "; ".join(f"{e['id']} ({e['law']}: {e['description']})" for e in els if e))
    body = llm.complete_json(system, "\n".join(facts), Letter, max_tokens=2048).body.strip()
    if "DRAFT" not in body.splitlines()[-1]:
        body += "\n\nDRAFT — for attorney review"
    return body
