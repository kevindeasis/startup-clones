"""Deterministic, network-free stand-in for the LLM extraction call."""
from __future__ import annotations

import datetime as dt
import re
from typing import Optional

from .matching import normalize
from .models import ExtractedLine, ExtractedOrder, PipelineContext

UNIT_MAP = {
    "cs": "cs", "case": "cs", "cases": "cs", "caja": "cs", "cajas": "cs",
    "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb", "libra": "lb", "libras": "lb",
    "pc": "ea", "pcs": "ea", "ea": "ea", "each": "ea", "piece": "ea", "pieces": "ea",
    "box": "box", "boxes": "box", "kg": "kg",
    "dz": "dz", "doz": "dz", "dozen": "dz", "docena": "dz", "docenas": "dz",
    "tray": "tray", "trays": "tray",
}
_UNITS = "|".join(sorted(UNIT_MAP, key=len, reverse=True))
LINE_RE = re.compile(
    rf"(?<![\w#/:.-])(\d+(?:\.\d+)?)\s*(?:({_UNITS})\b)?\s*(?:of\s+|de\s+)?(.+)$", re.I)
TRAIL_RE = re.compile(r"^(.+?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(" + _UNITS + r")?$", re.I)
REPEAT_RE = re.compile(
    r"(same as last (?:\w+)|same as usual|the usual(?: order)?(?!\s+\w)|usual order(?!\s+\w)|repeat last(?: order)?|"
    r"repeat of last (?:\w+)|lo de siempre|igual que el (?:\w+) pasado|mismo pedido)", re.I)
SKIP_PREFIX = re.compile(r"^\s*(from|to|cc|subject|date|tel|phone|sent|reply-to)\s*:", re.I)

WEEKDAYS = {
    "monday": 0, "mon": 0, "lunes": 0, "tuesday": 1, "tues": 1, "tue": 1, "martes": 1,
    "wednesday": 2, "wed": 2, "miercoles": 2, "thursday": 3, "thurs": 3, "thur": 3, "thu": 3,
    "jueves": 3, "friday": 4, "fri": 4, "viernes": 4, "saturday": 5, "sat": 5, "sabado": 5,
    "sunday": 6, "sun": 6, "domingo": 6,
}
_DAY_RE = re.compile(r"\b(" + "|".join(sorted(WEEKDAYS, key=len, reverse=True)) + r"|tomorrow|tmrw|tmr|manana)\b")


def resolve_day(word: str, today: dt.date) -> Optional[dt.date]:
    word = normalize(word)
    if word in ("tomorrow", "tmrw", "tmr", "manana"):
        return today + dt.timedelta(days=1)
    if word in WEEKDAYS:
        delta = (WEEKDAYS[word] - today.weekday()) % 7 or 7
        return today + dt.timedelta(days=delta)
    return None


def _segments(text: str) -> list[str]:
    segs: list[str] = []
    for raw in text.splitlines():
        if SKIP_PREFIX.match(raw):
            continue
        raw = raw.replace("|", " ")
        for part in re.split(r"[;,]|\s/\s|\s[—–-]\s|\.\s+|\s+(?:and|y)\s+", raw):
            part = part.strip(" \t-*•")
            if part:
                segs.append(part)
    return segs


def _clean_product(t: str) -> str:
    t = re.sub(r"\b(please|pls|thanks|thank you|gracias|for me)\b.*$", "", t, flags=re.I)
    return t.strip(" .:-")


def mock_extract(text: str, context: PipelineContext, has_image: bool = False) -> ExtractedOrder:
    today = context.today
    text = text or ""
    if has_image and not text.strip():
        return ExtractedOrder(
            customer_name_hint="Sakura",
            delivery_date_hint="Thurs",
            delivery_date=resolve_day("thurs", today).isoformat(),
            lines=[
                ExtractedLine(raw_text="3 cs hotate U10", qty=3, unit="cs", product_text="hotate U10"),
                ExtractedLine(raw_text="2 lb ikura", qty=2, unit="lb", product_text="ikura"),
                ExtractedLine(raw_text="1 whole branzino", qty=1, unit=None, product_text="whole branzino"),
            ],
            questions=["Mock mode: image reading requires ANTHROPIC_API_KEY"],
            language="en",
        )

    repeat = REPEAT_RE.search(text)
    repeat_ref = repeat.group(1) if repeat else None
    scan = REPEAT_RE.sub(" ", text) if repeat else text

    lines: list[ExtractedLine] = []
    for seg in _segments(text):
        rm = REPEAT_RE.search(seg)
        if rm:
            rest = (seg[:rm.start()] + " " + seg[rm.end():]).strip()
            rest = re.sub(r"^(for|de|para)\s+(the\s+|los\s+|las\s+)?", "", rest, flags=re.I).strip()
            lines.append(ExtractedLine(raw_text=seg, qty=None, unit=None,
                                       product_text=_clean_product(rest)))
            continue
        qty = unit = None
        prod = ""
        m = LINE_RE.search(seg)
        if m:
            qty = float(m.group(1))
            unit = UNIT_MAP.get((m.group(2) or "").lower())
            prod = _clean_product(m.group(3))
        else:
            t = TRAIL_RE.match(seg)
            if t:
                prod, qty = _clean_product(t.group(1)), float(t.group(2))
                unit = UNIT_MAP.get((t.group(3) or "").lower())
        if qty is None or not re.search(r"[A-Za-z]{2,}", prod):
            continue
        lines.append(ExtractedLine(raw_text=seg, qty=qty, unit=unit, product_text=prod))

    hint = None
    dm = _DAY_RE.search(normalize(scan))
    ddate = resolve_day(dm.group(1), today) if dm else None
    fm = re.search(r"^from:\s*\"?([^<\"\n@]+?)\"?\s*(?:<|$)", text, re.I | re.M)
    if fm:
        hint = fm.group(1).strip()
    sig = [l.strip() for l in text.splitlines() if l.strip()]
    if sig and re.match(r"^[\W]*(thanks|gracias|regards|saludos|--)", sig[-2] if len(sig) > 1 else "", re.I):
        hint = sig[-1].strip(" -—")

    questions: list[str] = []
    if not lines and not repeat_ref:
        questions.append("No order lines could be identified in this message.")
    lang = "es" if re.search(r"\b(necesito|cajas|gracias|buenos|para el|docenas|libras)\b", text, re.I) else "en"
    return ExtractedOrder(
        customer_name_hint=hint,
        delivery_date_hint=dm.group(1) if dm else None,
        delivery_date=ddate.isoformat() if ddate else None,
        repeat_reference=repeat_ref,
        lines=lines,
        questions=questions,
        language=lang,
    )
