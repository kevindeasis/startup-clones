"""Deterministic trigger evaluation, plus preview (matched / exclusions / conflicts)."""
import re
from functools import lru_cache
from typing import Callable, Optional

Classifier = Callable[[dict, str, list], "tuple[bool, str]"]


@lru_cache(maxsize=512)
def _rx(pattern: str):
    return re.compile(pattern, re.IGNORECASE)


def _content(m) -> str:
    return m.get("content") or ""


def _tool_name_for(msg: dict, messages: list) -> str:
    if msg.get("name"):
        return msg["name"]
    cid = msg.get("callId")
    for m in messages:
        for tc in m.get("toolCalls") or []:
            if tc.get("callId") == cid:
                return tc.get("name", "")
    return ""


def describe(cond: dict) -> str:
    t = cond["type"]
    if t == "message_matches":
        return f"{cond.get('role','any')} message ({cond.get('where','any')}) matches /{cond['pattern']}/"
    if t == "tool_called":
        return f"tool {cond['name']} called >= {cond.get('min_count', 1)}x"
    if t == "tool_result_matches":
        return f"tool {cond['name']} result matches /{cond['pattern']}/"
    if t == "user_segment":
        return f"user segment in {cond['in']}"
    if t == "entry_point":
        return f"entry point in {cond['in']}"
    if t == "turn_index_min":
        return f"turn index >= {cond['value']}"
    return t


def eval_condition(cond: dict, trace: dict) -> bool:
    t = cond["type"]
    msgs = trace.get("messages") or []
    if t == "message_matches":
        role = cond.get("role", "any")
        pool = [m for m in msgs if (m["role"] == role if role != "any" else m["role"] in ("user", "assistant"))]
        if cond.get("where", "any") == "last":
            pool = pool[-1:]
        rx = _rx(cond["pattern"])
        return any(rx.search(_content(m)) for m in pool)
    if t == "tool_called":
        n = sum(1 for m in msgs if m["role"] == "assistant"
                for tc in (m.get("toolCalls") or []) if tc.get("name") == cond["name"])
        return n >= int(cond.get("min_count", 1))
    if t == "tool_result_matches":
        rx = _rx(cond["pattern"])
        return any(m["role"] == "tool" and _tool_name_for(m, msgs) == cond["name"] and rx.search(_content(m))
                   for m in msgs)
    if t == "user_segment":
        return (trace.get("user") or {}).get("segment") in cond["in"]
    if t == "entry_point":
        return trace.get("entryPoint") in cond["in"]
    if t == "turn_index_min":
        return int(trace.get("conversationRevision", 1)) >= int(cond["value"])
    raise ValueError(f"unknown condition type {t}")


def evaluate(trigger: dict, trace: dict, classify: Optional[Classifier] = None) -> dict:
    """Evaluate one trigger on one trace.

    Returns {matched, conditions:[{type, desc, ok}], situation: None|{ok, reason, evaluated}, error}.
    The semantic situation is only evaluated when every deterministic condition passes.
    """
    conds = [{"type": c["type"], "desc": describe(c), "ok": eval_condition(c, trace)}
             for c in trigger.get("all", [])]
    det_ok = all(c["ok"] for c in conds)
    res = {"matched": det_ok, "conditions": conds, "situation": None, "error": False}
    sit = trigger.get("situation")
    if sit:
        if not det_ok:
            res["situation"] = {"ok": None, "reason": "not evaluated", "evaluated": False}
            res["matched"] = False
        else:
            try:
                if classify is None:
                    raise RuntimeError("no classifier available")
                ok, reason = classify(trace, sit, trigger.get("situation_keywords") or [])
                res["situation"] = {"ok": bool(ok), "reason": reason, "evaluated": True}
                res["matched"] = bool(ok)
            except Exception as e:  # fail closed
                res["situation"] = {"ok": False, "reason": f"classifier error: {e}", "evaluated": True}
                res["matched"] = False
                res["error"] = True
    return res


def _last_user(trace: dict) -> str:
    for m in reversed(trace.get("messages") or []):
        if m["role"] == "user":
            return (m.get("content") or "")[:160]
    return ""


def preview(trigger: dict, turns: list, classify: Optional[Classifier] = None,
            other_active: Optional[list] = None, max_listed: int = 50, max_semantic: int = 100) -> dict:
    """turns: list of (turn_row_dict, trace_dict). Returns matched / exclusions / conflicts."""
    matched, exclusions = [], []
    n_matched = n_excl = 0
    sem_calls = 0
    overlaps = {c["id"]: 0 for c in (other_active or [])}
    for row, trace in turns:
        use = classify
        if trigger.get("situation") and classify is not None:
            sem_calls += 1
            if sem_calls > max_semantic:
                use = None
        ev = evaluate(trigger, trace, use)
        entry = {"trace_id": row["trace_id"], "conversation_id": row["conversation_id"],
                 "revision": row["revision"], "last_user_message": _last_user(trace),
                 "outcome_success": row["outcome_success"]}
        if ev["matched"]:
            n_matched += 1
            if len(matched) < max_listed:
                matched.append({**entry, "matched_conditions": [c["desc"] for c in ev["conditions"]],
                                "situation_reason": (ev["situation"] or {}).get("reason")})
            for oc in other_active or []:
                if evaluate({**oc["trigger"], "situation": None}, trace)["matched"]:
                    overlaps[oc["id"]] += 1
        else:
            ok = [c["desc"] for c in ev["conditions"] if c["ok"]]
            bad = [c["desc"] for c in ev["conditions"] if not c["ok"]]
            sit = ev["situation"]
            if sit and sit.get("evaluated") and not sit["ok"]:
                bad.append("situation: " + (sit.get("reason") or "no match"))
            if bad and (ok or (sit and sit.get("evaluated"))):
                n_excl += 1
                if len(exclusions) < max_listed:
                    exclusions.append({**entry, "matched_conditions": ok, "failed_conditions": bad})
    conflicts = [{"correction_id": c["id"], "title": c["title"], "overlapping_turns": overlaps[c["id"]]}
                 for c in (other_active or []) if overlaps[c["id"]] > 0]
    return {"matched": matched, "exclusions": exclusions, "conflicts": conflicts,
            "counts": {"scanned": len(turns), "matched": n_matched, "exclusions": n_excl,
                       "matched_conversations": len({m["conversation_id"] for m in matched})}}
