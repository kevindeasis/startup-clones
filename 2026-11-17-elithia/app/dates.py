"""Date finding and normalisation (four formats from the spec, plus a few common extras)."""
import re
from datetime import date

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}
_MON = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"

DATE_RE = re.compile(
    r"(?P<iso>\b(?P<iy>(?:19|20)\d{2})-(?P<im>\d{2})-(?P<id>\d{2})\b)"
    r"|(?P<us>\b(?P<um>\d{1,2})/(?P<ud>\d{1,2})/(?P<uy>(?:19|20)?\d{2})\b)"
    r"|(?P<mdy>\b(?P<mm>" + _MON + r")\.?\s+(?P<md>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<my>(?:19|20)\d{2})\b)"
    r"|(?P<dmy>\b(?P<dd>\d{1,2})(?:st|nd|rd|th)?\s+(?P<dm>" + _MON + r")\.?,?\s+(?P<dy>(?:19|20)\d{2})\b)",
    re.IGNORECASE,
)


def _mk(y: int, m: int, d: int):
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def _from_match(m: re.Match):
    if m.group("iso"):
        return _mk(int(m.group("iy")), int(m.group("im")), int(m.group("id")))
    if m.group("us"):
        y = int(m.group("uy"))
        if y < 100:
            y += 2000
        return _mk(y, int(m.group("um")), int(m.group("ud")))
    if m.group("mdy"):
        return _mk(int(m.group("my")), MONTHS[m.group("mm").lower()], int(m.group("md")))
    if m.group("dmy"):
        return _mk(int(m.group("dy")), MONTHS[m.group("dm").lower()], int(m.group("dd")))
    return None


def find_dates(text: str):
    """Return [(start, end, iso)] for every valid date in text."""
    out = []
    for m in DATE_RE.finditer(text or ""):
        iso = _from_match(m)
        if iso:
            out.append((m.start(), m.end(), iso))
    return out


def normalize_date(s):
    """Normalise a single date string to ISO (YYYY-MM-DD) or None."""
    if not s:
        return None
    s = str(s).strip()
    m = DATE_RE.search(s)
    return _from_match(m) if m else None
