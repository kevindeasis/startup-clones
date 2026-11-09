"""Pure matching helpers: normalisation + fuzzy catalog match."""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, Optional

from rapidfuzz import fuzz, process

AMBIGUITY_GAP = 3.0  # if 2nd-best SKU is this close (points), cap confidence
AMBIGUOUS_CAP = 0.85

# unit compatibility: ordered unit -> product units it can sensibly be bought in
_COMPAT = {
    "dz": {"dz"},
    "lb": {"lb", "cs", "ea", "tray"},
    "kg": {"lb", "cs", "tray"},
    "tray": {"tray", "lb"},
}


def normalize(text: str) -> str:
    """Lowercase, strip accents/punctuation, collapse whitespace."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9/ ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _unit_penalty(unit: Optional[str], product_unit: str) -> float:
    if not unit:
        return 1.0
    allowed = _COMPAT.get(unit)
    if allowed is None or product_unit in allowed:
        return 1.0
    return 0.9


def match_line(product_text: str, customer_aliases: dict[str, str], products: Iterable,
               unit: Optional[str] = None) -> tuple[Optional[str], float, list[dict]]:
    """Return (sku, confidence, top-3 candidates [{sku,name,score}]).

    customer_aliases maps normalized raw text -> sku. Products need
    .sku/.name/.unit/.aliases (comma separated)/.active.
    """
    q = normalize(product_text)
    products = [p for p in products if getattr(p, "active", True)]
    by_sku = {p.sku: p for p in products}
    if not q:
        return None, 0.0, []

    alias_sku = customer_aliases.get(q)
    if alias_sku and alias_sku in by_sku:
        cands = [{"sku": alias_sku, "name": by_sku[alias_sku].name, "score": 1.0}]
        return alias_sku, 1.0, cands

    choices: dict[int, tuple[str, str, str]] = {}  # idx -> (text, sku, kind)
    for p in products:
        choices[len(choices)] = (normalize(p.name), p.sku, "name")
        for a in (x.strip() for x in p.aliases.split(",")):
            if a:
                choices[len(choices)] = (normalize(a), p.sku, "alias")

    # exact name / global alias hits
    for text, sku, kind in choices.values():
        if text == q:
            conf = 0.98 if kind == "name" else 0.95
            cands = [{"sku": sku, "name": by_sku[sku].name, "score": conf}]
            for c in _fuzzy_candidates(q, choices, by_sku, unit):
                if c["sku"] != sku and len(cands) < 3:
                    cands.append(c)
            return sku, conf, cands

    cands = _fuzzy_candidates(q, choices, by_sku, unit)
    if not cands:
        return None, 0.0, []
    best = cands[0]
    conf = best["score"]
    if len(cands) > 1 and (best["score"] - cands[1]["score"]) * 100 < AMBIGUITY_GAP:
        conf = min(conf, AMBIGUOUS_CAP)
    return best["sku"], round(conf, 3), cands


def _fuzzy_candidates(q, choices, by_sku, unit) -> list[dict]:
    texts = {i: c[0] for i, c in choices.items()}
    results = process.extract(q, texts, scorer=fuzz.WRatio, limit=None, processor=None)
    best: dict[str, float] = {}
    for _text, score, idx in results:
        sku = choices[idx][1]
        s = score / 100.0 * _unit_penalty(unit, by_sku[sku].unit)
        if s > best.get(sku, 0.0):
            best[sku] = s
    ranked = sorted(best.items(), key=lambda kv: -kv[1])[:3]
    return [{"sku": s, "name": by_sku[s].name, "score": round(v, 3)} for s, v in ranked]
