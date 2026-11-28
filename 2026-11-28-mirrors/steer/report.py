"""Per-correction measurement: delivered vs held-out conversations, success rates, lift."""
import json

from .db import turn_trace
from .discovery import any_detector_fires


def _rate(s, n):
    return round(s / n, 4) if n else None


def build_report(db, correction: dict) -> dict:
    deliveries = db.list_deliveries(correction["id"])
    active = [d for d in deliveries if d["mode"] == "active"]
    conv_group = {}
    for d in active:
        conv_group.setdefault(d["conversation_id"], d["group_name"])
    shadow_convs = {d["conversation_id"] for d in deliveries if d["mode"] == "shadow"}
    groups = {g: {"conversations": 0, "successes": 0, "pending": 0, "rate": None} for g in ("treatment", "holdout")}
    repeating = {"treatment": 0, "holdout": 0}
    for conv, group in conv_group.items():
        turns = db.list_turns(correction["agent_id"], limit=1000, conversation_id=conv, newest_first=False)
        turns.sort(key=lambda r: r["revision"])
        decided = [t for t in turns if t["outcome_success"] is not None]
        if not decided:
            groups[group]["pending"] += 1
            continue
        g = groups[group]
        g["conversations"] += 1
        g["successes"] += decided[-1]["outcome_success"]
        if any_detector_fires(json.loads(turns[-1]["messages_json"])):
            repeating[group] += 1
    for g in groups.values():
        g["rate"] = _rate(g["successes"], g["conversations"])
    t, h = groups["treatment"], groups["holdout"]
    lift = round(t["rate"] - h["rate"], 4) if t["rate"] is not None and h["rate"] is not None else None
    return {"correction_id": correction["id"], "title": correction["title"], "status": correction["status"],
            "holdout_pct": correction["holdout_pct"], "treatment": t, "holdout": h, "lift": lift,
            "deliveries": sum(1 for d in active if d["delivered"]),
            "still_repeating": repeating["treatment"] + repeating["holdout"],
            "still_repeating_by_group": repeating,
            "shadow_matched_conversations": len(shadow_convs)}
