import re
from datetime import date, datetime, timedelta

from . import db, llm

POS = ("excited", "positive", "constructive", "impressed", "bullish", "supportive", "encouraged", "pleased", "strong interest", "increase", "add to")
NEG = ("worried", "disappointed", "skeptical", "negative", "bearish", "frustrated", "trim", "reduce", "sell", "cautious")
TOPICS = {"margins": "margin", "guidance": "guidance", "capital allocation": "buyback|dividend|capital allocation",
          "backlog": "backlog|orders", "competition": "competit", "supply chain": "supply chain|component",
          "m&a": "acquisition|m&a", "ai": r"\bai\b|artificial intelligence", "international": "europe|asia|international|china",
          "management": "ceo|cfo|management|succession", "revenue growth": "revenue|growth"}


def _due(line: str, today: date) -> str:
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", line)
    if m:
        return m.group(1)
    l = line.lower()
    if "tomorrow" in l:
        return (today + timedelta(days=1)).isoformat()
    if "next week" in l:
        return (today + timedelta(days=7)).isoformat()
    if "end of month" in l or "next month" in l:
        return (today + timedelta(days=30)).isoformat()
    m = re.search(r"in (\d+) days", l)
    if m:
        return (today + timedelta(days=int(m.group(1)))).isoformat()
    return ""


def mock_extract(notes: str, today: date | None = None) -> dict:
    today = today or date.today()
    inv = ""
    m = re.search(r"(?:investor|fund|firm)\s*:\s*(.+)", notes, re.I) or \
        re.search(r"(?i:meeting|call|met|lunch|dinner)\s+with\s+([A-Z][\w&.\- ]+?(?:Capital|Partners|Management|Advisors|Asset Management|Investments|Fund|Group|LLC|LP|Research)?)(?=\s*(?:\(|,|\.|\n|on\b|about\b|re\b|-|:|$))", notes)
    if m:
        inv = m.group(1).strip().rstrip(".")
    attendees = []
    am = re.search(r"attendees?\s*:\s*(.+)", notes, re.I)
    if am:
        attendees = [a.strip() for a in re.split(r",|;| and ", re.split(r"\.(?:\s|$)", am.group(1))[0]) if a.strip()]
    low = notes.lower()
    topics = [t for t, pat in TOPICS.items() if re.search(pat, low)]
    pos = sum(low.count(w) for w in POS)
    neg = sum(low.count(w) for w in NEG)
    sentiment = "positive" if pos > neg else "negative" if neg > pos else "neutral"
    concerns, steps = [], []
    for line in [l.strip(" -*\t") for l in re.split(r"\n|(?<=[.!?])\s+", notes) if l.strip()]:
        ll = line.lower()
        if re.search(r"concern|worr|skeptic|disappoint|risk", ll):
            concerns.append(line)
        if re.search(r"follow[- ]up|send|schedule|will share|to provide|action|next step|asked (us|for)|intro", ll):
            owner = "Investor" if re.search(r"\b(they|he|she|investor)\b.*\b(will|to)\b", ll) and not re.search(r"\bwe\b|\bir\b", ll) else "IR"
            steps.append({"action": line, "owner": owner, "due": _due(line, today)})
    first = re.split(r"(?<=[.!?])\s+", notes.strip())[0][:200] if notes.strip() else ""
    dm = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", notes)
    return {"investor": inv or "Unknown investor", "attendees": attendees, "topics": topics, "sentiment": sentiment,
            "concerns": concerns, "next_steps": steps, "summary": first, "date": dm.group(1) if dm else today.isoformat()}


def _llm_extract(notes: str, today: date) -> dict:
    system = ("You extract structured CRM data from raw investor meeting notes for an IR team. Today is "
              f"{today.isoformat()}; resolve relative dates to ISO dates. Use empty strings when unknown.")
    schema = ('{"investor": str, "attendees": [str], "topics": [str], "sentiment": "positive|neutral|negative", '
              '"concerns": [str], "next_steps": [{"action": str, "owner": str, "due": "YYYY-MM-DD or empty"}], '
              '"summary": str, "date": "YYYY-MM-DD"}')
    return llm.complete_json(system, notes, schema)


def process_notes(notes: str, today: date | None = None) -> dict:
    today = today or date.today()
    data = mock_extract(notes, today) if llm.is_mock() else _llm_extract(notes, today)
    name = (data.get("investor") or "Unknown investor").strip()
    sentiment = data.get("sentiment") if data.get("sentiment") in ("positive", "neutral", "negative") else "neutral"
    d = data.get("date") or today.isoformat()
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        d = today.isoformat()
    import json
    with db.connect() as c:
        row = c.execute("SELECT id FROM investors WHERE name=? COLLATE NOCASE", (name,)).fetchone()
        created = row is None
        if created:
            inv_id = c.execute("INSERT INTO investors(name, created_at) VALUES(?,?)", (name, db.now())).lastrowid
        else:
            inv_id = row["id"]
        iid = c.execute(
            "INSERT INTO interactions(investor_id, date, summary, topics_json, sentiment, concerns_json, next_steps_json, raw_notes) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (inv_id, d, data.get("summary", ""), json.dumps(data.get("topics", [])), sentiment,
             json.dumps(data.get("concerns", [])), json.dumps(data.get("next_steps", [])), notes)).lastrowid
    return {"investor_id": inv_id, "investor_created": created, "interaction_id": iid, "extracted": {**data, "sentiment": sentiment, "date": d},
            "mock": llm.is_mock()}


def list_investors() -> list[dict]:
    invs = db.rows("SELECT * FROM investors ORDER BY name")
    for i in invs:
        ints = db.rows("SELECT * FROM interactions WHERE investor_id=? ORDER BY date, id", (i["id"],))
        i["meeting_count"] = len(ints)
        i["last_contact"] = ints[-1]["date"] if ints else None
        steps = db.jl(ints[-1]["next_steps_json"]) if ints else []
        i["next_step"] = steps[0] if steps else None
        i["sentiment_trend"] = [x["sentiment"] for x in ints][-5:]
    return invs


def get_investor(inv_id: int) -> dict | None:
    i = db.one("SELECT * FROM investors WHERE id=?", (inv_id,))
    if not i:
        return None
    ints = db.rows("SELECT * FROM interactions WHERE investor_id=? ORDER BY date DESC, id DESC", (inv_id,))
    for x in ints:
        x["topics"], x["concerns"], x["next_steps"] = db.jl(x["topics_json"]), db.jl(x["concerns_json"]), db.jl(x["next_steps_json"])
    i["interactions"] = ints
    return i
