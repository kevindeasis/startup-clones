"""Recurring-mistake discovery: LLM path (Anthropic) + deterministic mock heuristics."""
import re

from .db import turn_trace
from .llm import LLMError, compress_trace
from .models import Trigger

DECLINE_RX = r"no thanks|just cancel|don't want|not interested|already (said|declined)|stop offering"
TRIED_RX = r"already (tried|restarted|rebooted)|i (restarted|rebooted)"

_DECLINE = re.compile(DECLINE_RX, re.I)
_TRIED = re.compile(TRIED_RX, re.I)
_ASK_RESTART = re.compile(r"(please|try|can you|could you)\W+(\w+\W+){0,3}(restart|reboot|power cycle)", re.I)


def _discount_reoffered(messages):
    calls = sum(1 for m in messages if m["role"] == "assistant"
                for tc in (m.get("toolCalls") or []) if tc["name"] == "offer_discount")
    declined = any(m["role"] == "user" and _DECLINE.search(m.get("content") or "") for m in messages)
    return calls >= 2 and declined


def _troubleshooting_restarted(messages):
    seen = False
    for m in messages:
        if m["role"] == "user" and _TRIED.search(m.get("content") or ""):
            seen = True
        elif seen and m["role"] == "assistant" and _ASK_RESTART.search(m.get("content") or ""):
            return True
    return False


DETECTORS = [
    {"key": "discount_reoffer", "fn": _discount_reoffered,
     "title": "Re-offers retention discount after the customer already declined",
     "description": "The agent offers the retention discount again after the customer said they do not want it, "
                    "which frustrates customers who are trying to cancel.",
     "guidance": "The customer has already declined the retention discount, so do not offer it again (or any other "
                 "discount). Acknowledge their decision and help them cancel.",
     "trigger": {"all": [{"type": "tool_called", "name": "offer_discount", "min_count": 1},
                         {"type": "message_matches", "role": "user", "pattern": DECLINE_RX, "where": "last"}]}},
    {"key": "troubleshoot_restart", "fn": _troubleshooting_restarted,
     "title": "Restarts troubleshooting the customer already completed",
     "description": "After the customer says they already restarted or rebooted, the agent asks them to restart "
                    "again instead of moving to the next diagnostic step.",
     "guidance": "The customer has already tried the basic steps (restart/reboot). Do not ask them to restart "
                 "again; acknowledge what they already tried and move to the next diagnostic step.",
     "trigger": {"all": [{"type": "message_matches", "role": "user", "pattern": TRIED_RX, "where": "last"}]}},
]


def any_detector_fires(messages) -> bool:
    return any(d["fn"](messages) for d in DETECTORS)


def heuristic_discover(turns: list) -> list:
    """turns: list of (row, trace). One evidence turn per conversation (latest firing turn)."""
    out = []
    for d in DETECTORS:
        by_conv = {}
        for row, trace in turns:
            if d["fn"](trace["messages"]):
                cur = by_conv.get(row["conversation_id"])
                if cur is None or row["revision"] > cur["revision"]:
                    by_conv[row["conversation_id"]] = row
        if len(by_conv) >= 2:
            out.append({"title": d["title"], "description": d["description"],
                        "evidence": [r["trace_id"] for r in by_conv.values()],
                        "suggested_guidance": d["guidance"], "suggested_trigger": d["trigger"]})
    return out


SYSTEM = ("You review production transcripts of an AI agent and find recurring mistakes: concrete, repeated "
          "behaviors that made the interaction go badly. Respond with JSON only.")

SCHEMA_HELP = """Return JSON: {"mistakes":[{"title": str, "description": str, "evidence": [turn numbers],
"suggested_guidance": "plain-language instruction to give the agent at the moment it matters",
"suggested_trigger": {"all":[condition,...], "situation":"optional natural-language situation"}}]}
Condition is one of: {"type":"message_matches","role":"user|assistant|any","pattern":"regex","where":"last|any"},
{"type":"tool_called","name":str,"min_count":int}, {"type":"tool_result_matches","name":str,"pattern":"regex"},
{"type":"user_segment","in":[str]}, {"type":"entry_point","in":[str]}, {"type":"turn_index_min","value":int}.
Return 1-5 mistakes; each needs at least 2 evidence turns."""


def llm_discover(llm, turns: list) -> list:
    lines = []
    for i, (row, trace) in enumerate(turns, 1):
        status = {1: "SUCCESS", 0: "FAILED"}.get(row["outcome_success"], "UNKNOWN")
        lines.append(f"Turn {i} [{status}]:\n{compress_trace(trace['messages'])}")
    data = llm.discover(SYSTEM, "\n\n".join(lines) + "\n\n" + SCHEMA_HELP)
    if not isinstance(data, dict):
        raise LLMError("discovery response was not a JSON object")
    out = []
    for m in data.get("mistakes") or []:
        ev = []
        for n in m.get("evidence") or []:
            try:
                idx = int(n)
            except (TypeError, ValueError):
                continue
            if 1 <= idx <= len(turns) and turns[idx - 1][0]["trace_id"] not in ev:
                ev.append(turns[idx - 1][0]["trace_id"])
        if len(ev) < 2 or not m.get("title"):
            continue
        trig = m.get("suggested_trigger") or {}
        try:
            trig = Trigger.model_validate(trig).to_dict()
        except Exception:
            trig = {"all": [], "situation": m.get("description") or m["title"]}
        out.append({"title": str(m["title"]), "description": str(m.get("description", "")), "evidence": ev,
                    "suggested_guidance": str(m.get("suggested_guidance", "")), "suggested_trigger": trig})
    return out[:5]


def discover(db, llm, agent_id: str, max_turns: int = 200) -> dict:
    rows = db.list_turns(agent_id, limit=max_turns, final_only=True)
    # prefer failed turns, then unknown outcome, then successes
    rank = {0: 0, None: 1, 1: 2}
    rows.sort(key=lambda r: rank.get(r["outcome_success"], 1))
    turns = [(r, turn_trace(r)) for r in rows]
    source, note = "heuristic", None
    mistakes = None
    if not getattr(llm, "mock", True):
        try:
            mistakes = llm_discover(llm, turns)
            source = "llm"
        except Exception as e:  # refusal, truncation, network: fall back to heuristics
            note = f"LLM discovery failed ({type(e).__name__}: {e}); used heuristics"
    if mistakes is None:
        mistakes = heuristic_discover(turns)
    stored = db.replace_mistakes(agent_id, mistakes)
    return {"mistakes": stored, "source": source, "note": note, "turns_considered": len(turns)}
