"""Hallucination judges: AnthropicJudge (LLM) and MockJudge (deterministic heuristics)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Protocol

from .config import Settings

FAILURE_TYPES = ("unsupported_number", "wrong_date", "invented_name", "unsupported_claim", "none")

_SENT_RE = re.compile(r"(?<=[.!?])\s+")
_NUM_RE = re.compile(r"[$€£]?\d[\d,]*(?:\.\d+)?(?:%|[MKBmkb]\b)?")
_YEAR_RE = re.compile(r"^(?:19|20)\d{2}$")
_NAME_RE = re.compile(r"\b[A-Z][a-z]+ [A-Z][a-z]+\b")
_WORD_RE = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "was", "were",
    "is", "are", "be", "been", "that", "this", "it", "its", "as", "at", "by", "from",
    "has", "have", "had", "will", "would", "than", "then", "year", "what", "which",
    "their", "they", "them", "about", "according",
}


def split_sentences(text: str) -> list[str]:
    """Single sentence splitter shared by judges and the dashboard highlighter."""
    return [s for s in _SENT_RE.split(text.strip()) if s]


def content_words(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall(text.lower()) if len(w) > 2 and w not in _STOP}


def best_overlap_sentence(target: str, candidates: list[str]) -> str | None:
    """Candidate sentence with the highest content-word overlap with `target`."""
    tw = content_words(target)
    best, best_n = None, -1
    for c in candidates:
        n = len(tw & content_words(c))
        if n > best_n:
            best, best_n = c, n
    return best


@dataclass
class JudgeResult:
    score: float
    risky_sentence: str | None
    source_sentence: str | None
    failure_type: str
    explanation: str
    model: str = "mock"


class Judge(Protocol):
    def score(self, prompt: str, answer: str, sources: list[str]) -> JudgeResult: ...


class MockJudge:
    """Deterministic heuristics: numbers/dates/names absent from sources, or low word overlap."""

    def score(self, prompt: str, answer: str, sources: list[str]) -> JudgeResult:
        src_text = " ".join(sources)
        src_sentences = [s for src in sources for s in (split_sentences(src) or [src])]
        src_nums = {m.group(0).rstrip(",") for m in _NUM_RE.finditer(src_text)}
        src_lower = src_text.lower()
        src_words = content_words(src_text)

        for sent in split_sentences(answer):
            ftype, detail = None, ""
            for m in _NUM_RE.finditer(sent):
                tok = m.group(0).rstrip(",")
                if tok in src_nums:
                    continue
                if _YEAR_RE.match(tok):
                    ftype, detail = "wrong_date", f"year {tok} does not appear in the sources"
                else:
                    ftype, detail = "unsupported_number", f"'{tok}' does not appear in the sources"
                break
            if ftype is None:
                for m in _NAME_RE.finditer(sent):
                    if m.start() == 0:
                        continue
                    if m.group(0).lower() not in src_lower:
                        ftype, detail = "invented_name", f"name '{m.group(0)}' does not appear in the sources"
                        break
            if ftype is None:
                words = content_words(sent)
                if len(words) >= 3 and len(words & src_words) < 2:
                    ftype, detail = "unsupported_claim", "sentence shares too few content words with the sources"
            if ftype:
                return JudgeResult(
                    0.92, sent, best_overlap_sentence(sent, src_sentences), ftype,
                    f"Mock heuristic: {detail}.", "mock",
                )
        return JudgeResult(0.08, None, None, "none", "Mock heuristic: answer is consistent with sources.", "mock")


_SYSTEM = "You are a strict fact-checker. Judge ONLY against the provided sources."

_INSTR = (
    "Return JSON ONLY, no prose, with keys: "
    '"sentences": [{"index": int, "supported": bool, "reason": str}], '
    '"hallucination_probability": float between 0 and 1, '
    '"riskiest_sentence_index": int (index into the answer sentences), '
    '"most_relied_source_index": int (index into the sources), '
    '"failure_type": one of unsupported_number, wrong_date, invented_name, unsupported_claim, none.'
)


def _extract_json(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def _idx(value: object, n: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if 0 <= value < n else None


class AnthropicJudge:
    def __init__(self, settings: Settings) -> None:
        import anthropic  # imported lazily so mock mode needs no network client

        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self._model = settings.judge_model
        self._fallback = MockJudge()

    def score(self, prompt: str, answer: str, sources: list[str]) -> JudgeResult:
        sentences = split_sentences(answer)
        src_block = "\n".join(f"[{i}] {s}" for i, s in enumerate(sources)) or "(no sources provided)"
        sent_block = "\n".join(f"[{i}] {s}" for i, s in enumerate(sentences))
        user = f"SOURCES:\n{src_block}\n\nUSER PROMPT:\n{prompt}\n\nANSWER SENTENCES:\n{sent_block}\n\n{_INSTR}"
        try:
            resp = self._client.messages.create(
                model=self._model, max_tokens=600, temperature=0, system=_SYSTEM,
                messages=[{"role": "user", "content": user}],
            )
            text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        except Exception as exc:  # network/API failure: degrade, never crash scoring
            r = self._fallback.score(prompt, answer, sources)
            r.explanation = f"judge call failed ({type(exc).__name__}); heuristic fallback"
            return r
        data = _extract_json(text)
        if data is None:
            r = self._fallback.score(prompt, answer, sources)
            r.explanation = "judge output unparseable; heuristic fallback"
            return r
        try:
            score = min(1.0, max(0.0, float(data.get("hallucination_probability", 0.0))))
        except (TypeError, ValueError):
            score = 0.0
        ri = _idx(data.get("riskiest_sentence_index"), len(sentences))
        si = _idx(data.get("most_relied_source_index"), len(sources))
        ftype = data.get("failure_type")
        if ftype not in FAILURE_TYPES:
            ftype = "unsupported_claim" if score >= 0.5 else "none"
        reasons = [
            str(s.get("reason", "")) for s in data.get("sentences", [])
            if isinstance(s, dict) and s.get("supported") is False and s.get("reason")
        ]
        explanation = "; ".join(reasons) or ("No unsupported sentences." if ftype == "none" else "Judged unsupported.")
        return JudgeResult(
            score, sentences[ri] if ri is not None else None,
            sources[si] if si is not None else None, ftype, explanation, self._model,
        )


def get_judge(settings: Settings) -> Judge:
    if settings.mock_mode:
        return MockJudge()
    return AnthropicJudge(settings)
