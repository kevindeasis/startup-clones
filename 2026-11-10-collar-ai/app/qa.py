import json
import re

from . import db, llm, retrieval

NOT_COVERED = "Not covered by disclosed materials — defer"
DESK_REFUSAL = ("I can't answer that from our publicly disclosed materials. "
                "Please contact the Investor Relations team directly and we will follow up.")

NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
RISK_FORWARD = ("expect", "forecast", "guidance", "outlook", "next quarter", "next year", "will grow", "project", "target", "fy2027", "2027")
RISK_FD = ("material", "nonpublic", "non-public", "ahead of", "off the record", "before the release", "reg fd", "private")


def _norm_num(s: str) -> str:
    return s.replace(",", "").rstrip(".")


def numbers_in(text: str) -> set[str]:
    return {_norm_num(n) for n in NUM_RE.findall(text)}


def validate_numbers(answer: str, cited_texts: list[str]) -> list[str]:
    """Every number in the answer must appear in a cited chunk; return warnings for the ones that don't."""
    allowed: set[str] = set()
    for t in cited_texts:
        allowed |= numbers_in(t)
    return [f"Number '{n}' in the answer does not appear in any cited chunk" for n in sorted(numbers_in(answer) - allowed)]


def _risk_flags(question: str, answer: str, cited_texts: list[str]) -> list[str]:
    flags = []
    ql = question.lower()
    if any(w in ql for w in RISK_FORWARD) and not any("guidance" in t.lower() or "outlook" in t.lower() for t in cited_texts):
        flags.append("Forward-looking question and no disclosed guidance/outlook was cited; do not speculate")
    if any(w in ql for w in RISK_FD):
        flags.append("Possible Reg FD concern: question probes non-public or selectively disclosed information")
    return flags


def _mock_answer(question: str, chunks: list[dict]) -> dict:
    top = chunks[0]
    sents = retrieval.best_sentences(question, top["text"], 2) or [top["text"][:200]]
    citations = [{"chunk_id": top["id"], "doc": top["title"], "quote": s} for s in sents[:1]]
    for c in chunks[1:2]:
        q = retrieval.best_sentences(question, c["text"], 1)
        if q:
            citations.append({"chunk_id": c["id"], "doc": c["title"], "quote": q[0]})
    conf = "high" if top["overlap"] >= 3 else "medium"
    return {"answer": " ".join(sents), "confidence": conf, "citations": citations,
            "disclosure_risk": [], "follow_ups": [f"Can you share more detail on {top['label']}?"]}


def _llm_answer(question: str, chunks: list[dict], desk: bool) -> dict:
    ctx = "\n\n".join(f"[chunk_id={c['id']}] ({c['title']} / {c['label']})\n{c['text']}" for c in chunks)
    role = ("an investor-facing IR front desk assistant" if desk else
            "an assistant helping an IR officer answer analyst questions live on an earnings call")
    system = (f"You are {role} for a public company. Answer ONLY from the provided chunks. Never invent figures: "
              "every number in your answer must appear verbatim in a cited chunk. Answer in 2-4 speakable sentences. "
              "Flag disclosure risks (forward-looking statements not in disclosed materials, Reg FD concerns). "
              "If the chunks do not answer the question, say so with confidence 'low' and no citations.")
    schema = ('{"answer": str, "confidence": "high|medium|low", "citations": [{"chunk_id": int, "doc": str, "quote": str}], '
              '"disclosure_risk": [str], "follow_ups": [str]}')
    return llm.complete_json(system, f"CHUNKS:\n{ctx}\n\nQUESTION: {question}", schema)


def answer_question(question: str, mode: str = "earnings-call", public_only: bool = False, k: int = 4) -> dict:
    question = question.strip()
    chunks = retrieval.retrieve(question, k=k, public_only=public_only)
    desk = mode == "front-desk" or public_only
    if not chunks:
        msg = DESK_REFUSAL if desk else NOT_COVERED
        return {"answer": msg, "confidence": "low", "citations": [], "disclosure_risk": _risk_flags(question, "", []),
                "follow_ups": [], "warnings": [], "mode": mode, "mock": llm.is_mock(), "refused": True}
    res = _mock_answer(question, chunks) if llm.is_mock() else _llm_answer(question, chunks, desk)
    by_id = {c["id"]: c for c in chunks}
    # keep only citations that point at retrieved chunks
    res["citations"] = [c for c in res.get("citations", []) if c.get("chunk_id") in by_id]
    res.setdefault("disclosure_risk", [])
    res.setdefault("follow_ups", [])
    res.setdefault("confidence", "medium")
    cited_texts = [by_id[c["chunk_id"]]["text"] for c in res["citations"]]
    res["warnings"] = validate_numbers(res.get("answer", ""), cited_texts)
    if not res["citations"] and "not covered" not in res.get("answer", "").lower():
        res["warnings"].append("Answer has no valid citations")
        res["confidence"] = "low"
    res["disclosure_risk"] = list(res["disclosure_risk"]) + [f for f in _risk_flags(question, res.get("answer", ""), cited_texts) if f not in res["disclosure_risk"]]
    res.update({"mode": mode, "mock": llm.is_mock(), "refused": False})
    return res


def log_qa(mode: str, question: str, response: dict) -> None:
    with db.connect() as c:
        c.execute("INSERT INTO qa_log(mode, question, response_json, created_at) VALUES(?,?,?,?)",
                  (mode, question, json.dumps(response), db.now()))
