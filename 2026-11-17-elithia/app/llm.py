"""LLM layer: MockLLM (deterministic heuristics) and AnthropicLLM (official SDK), one common interface.

    classify_pages(batch)  -> list[PageClass]
    extract_events(doc_batch) -> list[Event]       (events citing pages outside the batch are rejected)
    find_conflicts(events) -> list[Conflict]
"""
import json
import re
import time
from typing import Callable, Optional

from pydantic import BaseModel, Field

from . import config, prompts
from .dates import find_dates, normalize_date

CATEGORIES = {"visit", "imaging", "lab", "medication", "procedure", "diagnosis", "nursing", "discharge",
              "correspondence", "other"}
SIGNIFICANCE = {"low", "medium", "high"}


class PageClass(BaseModel):
    key: str
    doc_type: str = "other"
    facility: Optional[str] = None
    provider: Optional[str] = None
    service_date: Optional[str] = None
    page_role: str = "first"
    confidence: float = 0.0


class Event(BaseModel):
    id: Optional[int] = None
    date: Optional[str] = None
    time: Optional[str] = None
    facility: Optional[str] = None
    provider: Optional[str] = None
    category: str = "other"
    summary: str
    significance: str = "low"
    source_pages: list[str] = Field(default_factory=list)
    quote: str = ""


class Conflict(BaseModel):
    event_ids: list[int]
    description: str


# ------------------------------------------------------------------ validation helpers
def validate_events(raw_events, allowed_pages) -> list[Event]:
    """Coerce raw dicts to Events; reject events with no valid citation or any citation outside allowed_pages."""
    allowed = set(allowed_pages)
    out = []
    for r in raw_events or []:
        if not isinstance(r, dict):
            continue
        pages = r.get("source_pages") or []
        if isinstance(pages, str):
            pages = [pages]
        if not pages or any(p not in allowed for p in pages):
            continue  # unknown / missing citation -> reject
        summary = str(r.get("summary") or "").strip()
        if not summary:
            continue
        cat = str(r.get("category") or "other").lower()
        sig = str(r.get("significance") or "low").lower()
        t = r.get("time")
        out.append(Event(
            date=normalize_date(r.get("date")),
            time=str(t)[:5] if t and re.match(r"^\d{1,2}:\d{2}", str(t)) else None,
            facility=r.get("facility"), provider=r.get("provider"),
            category=cat if cat in CATEGORIES else "other",
            summary=summary[:600], significance=sig if sig in SIGNIFICANCE else "low",
            source_pages=list(dict.fromkeys(pages)), quote=str(r.get("quote") or "")[:200]))
    return out


def parse_json_defensive(text: str):
    """Parse model output: strip code fences, fall back to the outermost JSON array/object."""
    t = (text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    try:
        return json.loads(t)
    except ValueError:
        pass
    pairs = [(o, c) for o, c in (("[", "]"), ("{", "}")) if o in t]
    pairs.sort(key=lambda oc: t.find(oc[0]))
    for o, c in pairs:
        i, j = t.find(o), t.rfind(c)
        if i != -1 and j > i:
            try:
                return json.loads(t[i:j + 1])
            except ValueError:
                continue
    raise ValueError("model output is not valid JSON")


# ------------------------------------------------------------------ mock heuristics
DOC_RULES = [  # (regex on title text, doc_type, default category)
    (r"RADIOLOGY|X-RAY|IMAGING", "radiology report", "imaging"),
    (r"OPERATIVE REPORT|OPERATION NOTE", "operative report", "procedure"),
    (r"EMERGENCY DEPARTMENT|TRIAGE", "ED triage note", "visit"),
    (r"ADMISSION HISTORY|HISTORY AND PHYSICAL", "admission H&P", "visit"),
    (r"NURSING", "nursing notes", "nursing"),
    (r"DISCHARGE SUMMARY", "discharge summary", "discharge"),
    (r"LABORATORY|LAB RESULTS", "lab results", "lab"),
    (r"MEDICATION ADMINISTRATION|PHARMACY", "pharmacy MAR", "medication"),
    (r"PHYSIOTHERAPY|PHYSICAL THERAPY", "physio note", "visit"),
    (r"GENERAL PRACTITIONER|GP LETTER", "GP letter", "correspondence"),
]
DEFAULT_CATEGORY = {r[1]: r[2] for r in DOC_RULES}
LABEL_RE = re.compile(r"^(Allergies|Impression|Assessment|Plan|Procedure details|Preoperative diagnosis|Discharge medications|"
                      r"Medications on admission)\b", re.I)
SKIP_RE = re.compile(r"^(Date of service|Patient:|MRN)", re.I)
ABBREV = {"dr", "mr", "ms", "mrs", "st", "vs", "no", "approx", "e.g", "i.e"}
PROC_RE = re.compile(r"\b(hemiarthroplasty|arthroplasty|ORIF|appendectomy|cholecystectomy|laparotomy|laparoscopy|"
                     r"craniotomy|thoracotomy|fixation|amputation|biopsy|colectomy)\b", re.I)
NKDA_RE = re.compile(r"\b(NKDA|NKA|no known (?:drug )?allerg\w*)", re.I)
ALLERGEN = r"(penicillin|amoxicillin|sulfa\w*|latex|codeine|morphine|aspirin|iodine|contrast|cephalosporin\w*|nuts?)"
ALLERGY_RE = re.compile(r"allerg\w*[^.]{0,45}?\b" + ALLERGEN + r"\b|\b" + ALLERGEN + r"\b[^.]{0,25}allerg", re.I)
HIGH_RE = re.compile(r"fracture|\bfall\b|\bfell\b|allerg|anaphylaxis|hemiarthroplasty|arthroplasty|surgery|discharged|"
                     r"transfus|dislocat|sepsis|hemorrhage|haemorrhage|high falls risk", re.I)
MED_RE = re.compile(r"pain|hemoglobin|elevated|\blow\b|nausea|anaemia|fever|enoxaparin|oxycodone|staples|abnormal", re.I)
PREFIX_RE = re.compile(r"^\W*(?:DATE)\W*(?:\d{1,2}:\d{2})?\s*[-–—:]?\s*")


def first_sentence(text: str, limit: int = 300) -> str:
    for m in re.finditer(r"[.!?]\s+(?=[A-Z0-9(])", text):
        word = re.findall(r"(\w+)\.?$", text[:m.start() + 1])
        w = word[-1].lower() if word else ""
        if w in ABBREV or len(w) == 1:
            continue
        return text[:m.start() + 1].strip()[:limit]
    return text.strip()[:limit]


def _date_prefix(par: str):
    """If the paragraph begins with a date (+ optional time), return (iso, time, rest)."""
    ds = find_dates(par[:40])
    if ds and ds[0][0] <= 2:
        s, e, iso = ds[0]
        rest = par[e:]
        tm = re.match(r"\s+(\d{1,2}:\d{2})", rest)
        if tm:
            rest = rest[tm.end():]
        rest = re.sub(r"^\s*[-–—:]\s*", "", rest).strip()
        return iso, (tm.group(1) if tm else None), rest
    return None, None, par


def _title_text(paras):
    return " ".join(paras[:3]).upper()


def mock_classify_text(key: str, text: str) -> PageClass:
    paras = [p for p in text.split("\n\n") if p.strip()]
    title = _title_text(paras)
    doc_type, conf = "other", 0.3
    for rx, dt, _ in DOC_RULES:
        if re.search(rx, title):
            doc_type, conf = dt, 0.92
            break
    cont = "(CONTINUED)" in title
    m = re.search(r"Date of service:\s*(.+?)(?:\s\||$)", text)
    sdate = normalize_date(m.group(1)) if m else None
    pm = re.search(r"Provider:\s*(.+?)(?:\s\||\n|$)", text)
    fm = re.search(r"Page \d+ of \d+ \| (.+?)\s*$", text.strip())
    facility = fm.group(1).strip() if fm else (paras[0].strip() if paras else None)
    if facility:
        facility = re.sub(r"\s*\(rescan\)$", "", facility)
    if facility and facility.upper() == facility:
        facility = None
    if cont:
        conf = min(conf, 0.75)
    return PageClass(key=key, doc_type=doc_type, facility=facility, provider=pm.group(1).strip() if pm else None,
                     service_date=sdate, page_role="continuation" if cont else "first",
                     confidence=conf if doc_type != "other" else 0.3)


def mock_extract(doc_batch: dict) -> list[dict]:
    doc_type = doc_batch.get("doc_type") or "other"
    cat0 = DEFAULT_CATEGORY.get(doc_type, "other")
    sdate = doc_batch.get("service_date")
    events = []
    for pg in doc_batch["pages"]:
        for par in [p.strip() for p in pg["text"].split("\n\n") if p.strip()]:
            if SKIP_RE.match(par):
                continue
            iso, tm, rest = _date_prefix(par)
            labelled = bool(LABEL_RE.match(par))
            if iso is None:
                if labelled and sdate:
                    iso = sdate
                else:
                    ds = find_dates(par)
                    if not ds or par.isupper():
                        continue
                    iso = sdate or ds[0][2]
            summary = first_sentence(rest)
            if len(summary) < 12:
                continue
            cat = cat0
            if re.match(r"^(Impression|Assessment|Preoperative diagnosis)", par, re.I):
                cat = "diagnosis"
            elif doc_type in ("admission H&P",) and re.match(r"^Medications", par, re.I):
                cat = "medication"
            sig = "high" if HIGH_RE.search(par) and not re.search(r"no (?:signs?|evidence) of", par[:120], re.I) \
                else ("medium" if MED_RE.search(par) else "low")
            quote = par[:200]
            if len(par) > 200 and " " in quote:
                quote = quote.rsplit(" ", 1)[0]
            events.append(dict(date=iso, time=tm, facility=doc_batch.get("facility"), provider=doc_batch.get("provider"),
                               category=cat, summary=summary, significance=sig, source_pages=[pg["bates"]], quote=quote))
    return events


def mock_conflicts(events: list[dict]) -> list[dict]:
    out = []
    procs: dict[str, dict[str, list]] = {}
    nkda, allergy = [], []
    for e in events:
        text = f"{e.get('summary', '')} {e.get('quote', '')}"
        for m in PROC_RE.finditer(text):
            rem = text[m.end(): m.end() + 70]
            m2 = re.match(r"\s*(?:was\s+|were\s+)?(?:performed\s+)?(?:on|dated)\s+", rem)
            if not m2:
                continue
            ds = find_dates(rem[m2.end(): m2.end() + 25])
            if ds and ds[0][0] == 0:
                procs.setdefault(m.group(1).lower(), {}).setdefault(ds[0][2], [])
                if e["id"] not in procs[m.group(1).lower()][ds[0][2]]:
                    procs[m.group(1).lower()][ds[0][2]].append(e["id"])
        if NKDA_RE.search(text) and not ALLERGY_RE.search(text):
            nkda.append(e["id"])
        elif ALLERGY_RE.search(text):
            allergy.append(e["id"])
    for proc, by_date in procs.items():
        if len(by_date) > 1:
            ids = [i for v in by_date.values() for i in v]
            desc = "; ".join(f"{d} (event {', '.join('#%d' % i for i in v)})" for d, v in sorted(by_date.items()))
            out.append(dict(event_ids=ids, description=f"Conflicting dates for the same procedure ({proc}): {desc}."))
    if nkda and allergy:
        out.append(dict(event_ids=nkda + allergy[:3],
                        description="Allergy mismatch: some records state no known drug allergies (NKDA) while others "
                                    "document a specific drug allergy (e.g. penicillin)."))
    return out


# ------------------------------------------------------------------ clients
class LLMClient:
    mode = "mock"

    def __init__(self, case_id=None, recorder: Optional[Callable] = None, model=None):
        self.case_id = case_id
        self.recorder = recorder
        self.model = model or config.model_name()

    def _log(self, purpose, in_chars, out_chars, t0):
        if self.recorder:
            self.recorder(dict(case_id=self.case_id, purpose=purpose, model=self.model, mode=self.mode,
                               input_chars=in_chars, output_chars=out_chars,
                               latency_ms=int((time.time() - t0) * 1000)))

    # subclasses implement these three, returning (raw_python_object, input_chars, output_chars)
    def _classify(self, batch): raise NotImplementedError
    def _extract(self, doc_batch): raise NotImplementedError
    def _conflicts(self, events): raise NotImplementedError

    def classify_pages(self, batch: list[dict]) -> list[PageClass]:
        t0 = time.time()
        raw, i, o = self._classify(batch)
        by_key = {}
        for r in raw if isinstance(raw, list) else []:
            if isinstance(r, dict) and r.get("key") is not None:
                try:
                    r = dict(r)
                    r["key"] = str(r["key"])
                    r["service_date"] = normalize_date(r.get("service_date"))
                    r["page_role"] = "continuation" if str(r.get("page_role")).startswith("cont") else "first"
                    r["confidence"] = float(r.get("confidence") or 0)
                    r["doc_type"] = r.get("doc_type") or "other"
                    by_key[r["key"]] = PageClass(**r)
                except Exception:
                    continue
        self._log("classify_pages", i, o, t0)
        return [by_key.get(str(b["key"]), PageClass(key=str(b["key"]), confidence=0.0)) for b in batch]

    def extract_events(self, doc_batch: dict) -> list[Event]:
        t0 = time.time()
        raw, i, o = self._extract(doc_batch)
        self._log("extract_events", i, o, t0)
        return validate_events(raw, [p["bates"] for p in doc_batch["pages"]])

    def find_conflicts(self, events: list[dict]) -> list[Conflict]:
        t0 = time.time()
        raw, i, o = self._conflicts(events)
        self._log("find_conflicts", i, o, t0)
        ids = {e["id"] for e in events}
        out = []
        for r in raw or []:
            try:
                eids = [int(x) for x in r.get("event_ids", []) if int(x) in ids]
                if len(eids) >= 2 and r.get("description"):
                    out.append(Conflict(event_ids=eids, description=str(r["description"])))
            except (TypeError, ValueError, AttributeError):
                continue
        return out


class MockLLM(LLMClient):
    mode = "mock"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.model = "mock-heuristic"

    def _classify(self, batch):
        res = [mock_classify_text(str(b["key"]), b["text"]).model_dump() for b in batch]
        return res, sum(len(b["text"]) for b in batch), len(json.dumps(res))

    def _extract(self, doc_batch):
        res = mock_extract(doc_batch)
        return res, sum(len(p["text"]) for p in doc_batch["pages"]), len(json.dumps(res))

    def _conflicts(self, events):
        res = mock_conflicts(events)
        return res, len(json.dumps(events)), len(json.dumps(res))


class AnthropicLLM(LLMClient):
    mode = "live"

    def __init__(self, *a, client=None, **kw):
        super().__init__(*a, **kw)
        if client is None:
            key = config.api_key()
            if not key:
                raise RuntimeError("LLM_MODE=live requires ANTHROPIC_API_KEY")
            import anthropic
            client = anthropic.Anthropic(api_key=key)
        self.client = client

    def _call(self, user: str) -> str:
        resp = self.client.messages.create(model=self.model, max_tokens=4000, system=prompts.SYSTEM,
                                           messages=[{"role": "user", "content": user}])
        return "".join(getattr(b, "text", "") for b in resp.content)

    def _json(self, user: str):
        """Call the model asking for JSON only; retry once if the reply is not valid JSON."""
        out_chars = 0
        text = self._call(user)
        out_chars += len(text)
        try:
            return parse_json_defensive(text), out_chars
        except ValueError:
            retry = user + "\n\nYour previous reply was not valid JSON. Return ONLY valid JSON matching the schema."
            text = self._call(retry)
            out_chars += len(text)
            try:
                return parse_json_defensive(text), out_chars
            except ValueError:
                return None, out_chars

    def _classify(self, batch):
        body = "\n\n".join(f"[[PAGE {b['key']}]]\n{b['text'][:2500]}" for b in batch)
        user = f"{prompts.CLASSIFY_SCHEMA}\n\n{prompts.CLASSIFY_EXAMPLE}\n\nPAGES:\n{body}"
        raw, o = self._json(user)
        return raw, len(user), o

    def _extract(self, doc_batch):
        body = "\n\n".join(f"[[PAGE {p['bates']}]]\n{p['text']}" for p in doc_batch["pages"])
        head = f"Document type: {doc_batch.get('doc_type')}; facility: {doc_batch.get('facility')}; date: {doc_batch.get('service_date')}"
        user = f"{prompts.EVENT_SCHEMA}\n\n{prompts.EVENT_EXAMPLE}\n\n{head}\n\nPAGES:\n{body}"
        raw, o = self._json(user)
        return raw, len(user), o

    def _conflicts(self, events):
        slim = [{k: e.get(k) for k in ("id", "date", "time", "category", "summary", "quote")} for e in events]
        user = f"{prompts.CONFLICT_SCHEMA}\n\nEVENTS:\n{json.dumps(slim)}"
        raw, o = self._json(user)
        if isinstance(raw, dict):
            raw = raw.get("conflicts", [])
        return raw, len(user), o


def get_llm(case_id=None, recorder=None) -> LLMClient:
    if config.llm_mode() == "live":
        return AnthropicLLM(case_id, recorder)
    return MockLLM(case_id, recorder)
