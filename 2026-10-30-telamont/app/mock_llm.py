"""Deterministic mock LLM provider. Parses the JSON user prompts built in pipeline.py."""
import json
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional

NUM = r"(\d[\d,]*(?:\.\d+)?)"
HIGH_TOPICS = {
    "concrete_compressive_strength",
    "substantial_completion_days",
    "liquidated_damages_rate",
    "retainage_percent",
}
PRECEDENCE = {"contract": 0, "spec": 1, "drawing": 2, "schedule": 3, "other": 4}


def _strip_ntp(s: str) -> str:
    return re.sub(r"notice to proceed", "", s, flags=re.I)


def _t_strength(s: str):
    m = re.search(NUM + r"\s*psi\b", s, re.I)
    return f"{m.group(1)} psi" if m else None


def _t_completion(s: str):
    m = re.search(NUM + r"\s*calendar\s+days", s, re.I)
    return f"{m.group(1)} calendar days" if m and re.search(r"substantial completion|calendar days", s, re.I) else None


def _t_notice(s: str):
    s2 = _strip_ntp(s)
    if not re.search(r"\bnotice\b", s2, re.I):
        return None
    m = re.search(NUM + r"\s*(?:calendar\s+|business\s+|working\s+)?days", s2, re.I)
    return f"{m.group(1)} days" if m else None


def _t_ld(s: str):
    if not re.search(r"liquidated damages", s, re.I):
        return None
    m = re.search(r"\$\s?" + NUM + r"(?:\s*(?:per|/)\s*(?:calendar\s+)?day)?", s, re.I)
    return f"${m.group(1)} per day" if m else None


def _t_retainage(s: str):
    if not re.search(r"retainage|retention", s, re.I):
        return None
    m = re.search(NUM + r"\s*(?:%|percent)", s, re.I)
    return f"{m.group(1)}%" if m else None


def _t_warranty(s: str):
    if not re.search(r"warrant", s, re.I):
        return None
    m = re.search(NUM + r"\s*(year|month)s?", s, re.I)
    return f"{m.group(1)} {m.group(2).lower()}{'s' if m.group(1) != '1' else ''}" if m else None


def _t_air(s: str):
    if not re.search(r"air[\s-]*entrain", s, re.I):
        return None
    m = re.search(NUM + r"\s*(?:%|percent)", s, re.I)
    return f"{m.group(1)}%" if m else None


def _t_submittal(s: str):
    if not re.search(r"submit|submittal", s, re.I):
        return None
    m = re.search(NUM + r"\s*(?:calendar\s+)?days", s, re.I)
    return f"{m.group(1)} days" if m else None


# (topic, kind, extractor); order is irrelevant, a sentence may yield several topics
TOPICS = [
    ("concrete_compressive_strength", "technical", _t_strength),
    ("substantial_completion_days", "contractual", _t_completion),
    ("notice_period_days", "contractual", _t_notice),
    ("liquidated_damages_rate", "contractual", _t_ld),
    ("retainage_percent", "contractual", _t_retainage),
    ("warranty_period", "contractual", _t_warranty),
    ("air_entrainment_percent", "technical", _t_air),
    ("submittal_period_days", "compliance", _t_submittal),
]


def norm_value(value: str) -> str:
    """Normalize a literal value so '2 years' == '24 months', '4,000 psi' == '4000 psi'."""
    v = value.lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(year|month)s?", v)
    if m:
        n = float(m.group(1)) * (12 if m.group(2) == "year" else 1)
        return f"{n:g} months"
    m = re.search(r"(\d+(?:\.\d+)?)", v)
    if not m:
        return v.strip()
    n = m.group(1)
    return n.rstrip("0").rstrip(".") if "." in n else n


def sentences(text: str) -> List[str]:
    flat = re.sub(r"\s+", " ", text).strip()
    # split at sentence ends, semicolons, and before clause numbers / article-style headings
    parts = re.split(
        r"(?<=[^\d\s]\.)\s+|;\s+|\s+(?=(?:\d+\.\d+\s+[A-Z]|Article \d+ -|Section \d\d \d\d \d\d -|Part \d+ -))",
        flat,
    )
    return [s.strip() for s in parts if s.strip()]


def clause_ref(sentence: str) -> str:
    m = re.match(r"^(\d+(?:\.\d+)*)\.?\s", sentence)
    return m.group(1) if m else ""


def _quote(s: str) -> str:
    return s if len(s) <= 300 else s[:297] + "..."


def stage1(payload: Dict[str, Any]) -> Dict[str, Any]:
    reqs, risks = [], []
    for ch in payload.get("chunks", []):
        page, text = ch["page"], ch["text"]
        sents = sentences(text)
        for s in sents:
            for topic, kind, fn in TOPICS:
                val = fn(s)
                if val:
                    reqs.append(
                        {
                            "topic": topic,
                            "value": val,
                            "clause_ref": clause_ref(s),
                            "page": page,
                            "quote": _quote(s),
                            "kind": kind,
                        }
                    )
        low = _strip_ntp(text).lower()
        has_notice = bool(re.search(r"notice[^.]{0,120}?\d+\s*(?:calendar\s+)?days", low))
        for s in sents:
            sl = s.lower()
            if re.search(r"pay[- ]when[- ]paid|pay[- ]if[- ]paid", sl):
                risks.append(
                    {
                        "title": "Pay-when-paid clause exposes payment timing",
                        "category": "contractual",
                        "severity": "high",
                        "description": "Payment to subcontractors is conditioned on the Owner paying the Contractor, shifting owner credit risk downstream and potentially conflicting with prompt-payment statutes.",
                        "recommendation": "Confirm enforceability under local prompt-payment law; negotiate an outside date for payment regardless of Owner payment.",
                        "page": page,
                        "quote": _quote(s),
                    }
                )
            if "unlimited" in sl:
                risks.append(
                    {
                        "title": "Unlimited liability language",
                        "category": "contractual",
                        "severity": "high",
                        "description": "The clause uses 'unlimited', leaving exposure uncapped.",
                        "recommendation": "Seek a liability cap or carve-outs and confirm insurance coverage.",
                        "page": page,
                        "quote": _quote(s),
                    }
                )
            if "time is of the essence" in sl and not has_notice:
                risks.append(
                    {
                        "title": "Time is of the essence without a notice period",
                        "category": "contractual",
                        "severity": "medium",
                        "description": "Strict time obligations are stated with no notice-and-cure period nearby.",
                        "recommendation": "Add a written notice and cure period before default remedies apply.",
                        "page": page,
                        "quote": _quote(s),
                    }
                )
            m = re.search(r"section\s+((?:\d{2}\s?){3})\s*revision\s+([A-Z])\b", s, re.I)
            if m:
                risks.append(
                    {
                        "title": f"Unverified reference to Section {m.group(1).strip()} Revision {m.group(2).upper()}",
                        "category": "compliance",
                        "severity": "low",
                        "description": "The document cites a specific revision of a specification section; confirm that revision exists in the issued set.",
                        "recommendation": "Verify the revision against the specification issue log and correct the reference.",
                        "page": page,
                        "quote": _quote(s),
                    }
                )
    return {"requirements": reqs, "single_doc_risks": risks}


def stage2(payload: Dict[str, Any]) -> Dict[str, Any]:
    by_topic: Dict[str, list] = defaultdict(list)
    for c in payload.get("cards", []):
        by_topic[c["topic"]].append(c)
    out = []
    for topic, cards in sorted(by_topic.items()):
        docs = {c["document"] for c in cards}
        if len(docs) < 2:
            continue
        vals = {norm_value(c["value"]) for c in cards}
        if len(vals) < 2:
            continue
        seen, cites = set(), []
        for c in cards:  # one citation per distinct (document, value)
            k = (c["document"], norm_value(c["value"]))
            if k not in seen:
                seen.add(k)
                cites.append(c)
        cites = cites[:4]
        ranked = sorted(cites, key=lambda c: PRECEDENCE.get(c.get("doc_kind", "other"), 4))
        gov = ranked[0]
        human = topic.replace("_", " ")
        out.append(
            {
                "title": f"Conflicting {human}: " + " vs ".join(dict.fromkeys(c["value"] for c in cites)),
                "category": "contradiction",
                "severity": "high" if topic in HIGH_TOPICS else "medium",
                "description": (
                    f"Documents state different values for {human}: "
                    + "; ".join(f"{c['document']} p.{c['page']} says {c['value']}" for c in cites)
                    + f". By the usual order of precedence (Contract > Specifications > Drawings), {gov['document']} likely governs, "
                    "but confirm against the contract's order-of-precedence clause."
                ),
                "recommendation": f"Issue an RFI to resolve the {human} conflict and align all documents with the governing value ({gov['value']}).",
                "citations": [
                    {"document": c["document"], "page": c["page"], "quote": c["quote"]} for c in cites
                ],
            }
        )
    return {"risks": out}


def ask(payload: Dict[str, Any]) -> Dict[str, Any]:
    from .retrieval import tokenize

    ex = payload.get("excerpts", [])
    if not ex:
        return {"answer": "", "citations": []}
    qt = set(tokenize(payload.get("question", "")))
    parts, cites = [], []
    for e in ex[:3]:
        sents = sentences(e["text"])
        best = max(sents, key=lambda s: len(qt & set(tokenize(s)))) if sents else e["text"][:300]
        best = _quote(best)
        parts.append(f"{best} ({e['document']}, p.{e['page']})")
        cites.append({"document": e["document"], "page": e["page"], "quote": best})
    return {"answer": "Based on the documents: " + " ".join(parts), "citations": cites}


def notice(payload: Dict[str, Any]) -> str:
    r = payload["risk"]
    cites = payload.get("citations", [])
    refs = "\n".join(f'  - {c["document"]}, page {c["page"]}: "{c["quote"]}"' for c in cites) or "  - (none)"
    return (
        f"SUBJECT: Notice / Request for Information - {r['title']}\n\n"
        "To: [Counterparty name]\nFrom: [Your company]\nDate: [Date]\nProject reference: [Project / RFI No.]\n\n"
        "Dear [Recipient],\n\n"
        "Pursuant to the governing contract documents, we write regarding the following matter. "
        "The documents cited below contain provisions that bear on this issue:\n"
        f"{refs}\n\n"
        f"Statement of issue: {r['description']}\n\n"
        f"Requested action: {r['recommendation']}\n\n"
        "Please respond in writing by [response deadline - insert date]. We reserve all rights under the Contract, "
        "including time and cost adjustments, pending your response.\n\n"
        "Sincerely,\n[Name]\n[Title]"
    )


class MockProvider:
    name = "mock"
    model = "mock"

    def complete_json(self, system: str, user: str, schema_hint: str = "", task: Optional[str] = None):
        payload = json.loads(user)
        if task == "requirements":
            return stage1(payload)
        if task == "contradictions":
            return stage2(payload)
        if task == "ask":
            return ask(payload)
        raise ValueError(f"mock: unknown json task {task!r}")

    def complete_text(self, system: str, user: str, task: Optional[str] = None) -> str:
        if task == "notice":
            return notice(json.loads(user))
        return "Mock response."
