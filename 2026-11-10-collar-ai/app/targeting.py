from datetime import date, datetime

from . import config, db, llm

WEIGHTS = {"style": 30, "sector": 30, "aum": 15, "recency": 10, "holder": 8, "engagement": 7}


def _sector_set(s: str) -> set[str]:
    return {x.strip().lower() for x in (s or "").replace(";", ",").split(",") if x.strip()}


def score_investor(inv: dict, last_contact: str | None, meetings: int, as_of: date) -> dict:
    prof = config.COMPANY_PROFILE
    style = prof["style_affinity"].get((inv.get("style") or "").lower(), 0.3)
    mine, theirs = set(prof["sectors"]), _sector_set(inv.get("sectors", ""))
    sector = len(mine & theirs) / len(mine) * 2 if theirs else 0.0
    sector = min(sector, 1.0)
    lo, hi = prof["aum_sweet_spot_musd"]
    aum_v = inv.get("aum_musd") or 0
    if aum_v <= 0:
        aum = 0.0
    elif lo <= aum_v <= hi:
        aum = 1.0
    elif aum_v < lo:
        aum = max(0.0, aum_v / lo)
    else:
        aum = max(0.3, hi / aum_v)
    if last_contact:
        days = (as_of - datetime.strptime(last_contact, "%Y-%m-%d").date()).days
        recency = 1.0 if days <= 30 else 0.7 if days <= 90 else 0.4 if days <= 180 else 0.2
    else:
        recency = 0.3
    holder = 1.0 if inv.get("holds_us") else 0.0
    engagement = min(meetings, 5) / 5
    parts = {"style": style, "sector": sector, "aum": aum, "recency": recency, "holder": holder, "engagement": engagement}
    breakdown = {k: round(parts[k] * WEIGHTS[k], 2) for k in WEIGHTS}
    return {"score": round(sum(breakdown.values()), 2), "breakdown": breakdown}


def _mock_rationale(inv: dict, sc: dict) -> str:
    top = sorted(sc["breakdown"].items(), key=lambda kv: -kv[1])[:2]
    names = {"style": "investment style", "sector": "sector focus", "aum": "AUM size", "recency": "recent contact",
             "holder": "existing position", "engagement": "meeting history"}
    return (f"{inv['name']} ranks well on {names[top[0][0]]} and {names[top[1][0]]}. "
            f"As a {inv.get('style') or 'unclassified'} manager with ${inv.get('aum_musd', 0):,.0f}M AUM it is a "
            f"{'strong' if sc['score'] >= 60 else 'moderate'} fit for {config.COMPANY_PROFILE['name']}.")


def _llm_rationales(items: list[dict]) -> dict[int, str]:
    prof = config.COMPANY_PROFILE
    system = (f"You are an IR analyst. For each investor write exactly 2 sentences explaining why they fit "
              f"{prof['name']} ({prof['ticker']}; sectors: {', '.join(prof['sectors'])}) as a target. Use only the facts given.")
    user = "\n".join(f"id={i['id']}: {i['name']}, style={i.get('style')}, AUM=${i.get('aum_musd')}M, mandate={i.get('mandate')}, "
                     f"sectors={i.get('sectors')}, holds_us={bool(i.get('holds_us'))}, meetings={i['meeting_count']}, score={i['score']}, "
                     f"breakdown={i['breakdown']}" for i in items)
    out = llm.complete_json(system, user, '[{"id": int, "rationale": str}]')
    return {int(o["id"]): o["rationale"] for o in out}


def rank(top_n: int = 10, as_of: date | None = None) -> list[dict]:
    as_of = as_of or date.today()
    result = []
    for inv in db.rows("SELECT * FROM investors"):
        ints = db.rows("SELECT date FROM interactions WHERE investor_id=? ORDER BY date", (inv["id"],))
        last = ints[-1]["date"] if ints else None
        sc = score_investor(inv, last, len(ints), as_of)
        result.append({"id": inv["id"], "name": inv["name"], "style": inv["style"], "aum_musd": inv["aum_musd"],
                       "mandate": inv["mandate"], "sectors": inv["sectors"], "holds_us": bool(inv["holds_us"]),
                       "meeting_count": len(ints), "last_contact": last, **sc})
    result.sort(key=lambda r: (-r["score"], r["name"].lower()))
    top = result[:top_n]
    rats = {}
    if top and not llm.is_mock():
        try:
            rats = _llm_rationales(top)
        except Exception:
            rats = {}
    for i, r in enumerate(top):
        r["rank"] = i + 1
        r["rationale"] = rats.get(r["id"]) or _mock_rationale(r, r)
    return top
