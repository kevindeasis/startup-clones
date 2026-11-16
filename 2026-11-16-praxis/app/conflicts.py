"""Deterministic conflict check: fuzzy-match party names against clients, adverse parties and contacts."""
import json
import re

from rapidfuzz import fuzz

from . import db

SUFFIXES = {"inc", "llc", "corp", "ltd", "co"}
HIT, POSSIBLE = 85, 70


def normalize(name: str) -> str:
    s = re.sub(r"[^\w\s]", " ", (name or "").lower())
    return " ".join(t for t in s.split() if t not in SUFFIXES)


def _known_records() -> list[dict]:
    recs = []
    for c in db.q("SELECT id,name FROM clients"):
        recs.append({"name": c["name"], "source": "client", "source_id": c["id"], "matter_id": None})
    for m in db.q("SELECT id,adverse_parties_json FROM matters"):
        for n in json.loads(m["adverse_parties_json"] or "[]"):
            recs.append({"name": n, "source": "matter_adverse", "source_id": m["id"], "matter_id": m["id"]})
    for c in db.q("SELECT id,name,kind,matter_id FROM contacts"):
        recs.append({"name": c["name"], "source": f"contact_{c['kind']}", "source_id": c["id"], "matter_id": c["matter_id"]})
    return recs


def check_parties(parties: list[dict]) -> dict:
    """parties: [{name, role}]. Returns matches (all >= 70), conflict flag, possible flag."""
    records = _known_records()
    matches, conflict, possible = [], False, False
    for p in parties:
        pn = normalize(p["name"])
        if not pn:
            continue
        seen = set()
        for r in records:
            rn = normalize(r["name"])
            if not rn:
                continue
            score = round(fuzz.token_set_ratio(pn, rn), 1)
            if score < POSSIBLE:
                continue
            key = (r["name"].lower(), r["source"].split("_")[0], r["source_id"])
            if key in seen:
                continue
            seen.add(key)
            level = "hit" if score >= HIT else "possible"
            is_client_rec = r["source"] == "client"
            is_adverse_rec = r["source"] in ("matter_adverse", "contact_adverse")
            conflicting = (p["role"] == "adverse" and is_client_rec) or (p["role"] == "client" and is_adverse_rec)
            if conflicting:
                conflict = conflict or level == "hit"
                possible = possible or level == "possible"
            matches.append({
                "party": p["name"], "role": p["role"], "matched_name": r["name"], "source": r["source"],
                "source_id": r["source_id"], "matter_id": r["matter_id"], "score": score, "level": level,
                "conflicting": conflicting,
            })
    return {"matches": matches, "conflict": conflict, "possible": possible}


def describe(m: dict) -> str:
    where = {"client": "existing client", "matter_adverse": "adverse party on an existing matter",
             "contact_adverse": "adverse contact", "contact_counsel": "known counsel", "contact_other": "known contact"}.get(m["source"], m["source"])
    return f"{m['role']} party '{m['party']}' ~ '{m['matched_name']}' ({where}) score {m['score']}"
