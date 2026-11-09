"""LLM provider abstraction: AnthropicLLM (real) and MockLLM (deterministic, offline)."""
import json
import logging
import re

from pydantic import ValidationError

from . import heuristics as H
from .config import get_settings
from .schemas import AnalysisResult, ClassifyResult, ClusterName

log = logging.getLogger("agnost_clone.llm")

ANALYSIS_SYSTEM = (
    "You are a product analyst reading a transcript between a user and an AI product's assistant. "
    "Extract signals a product team cares about. Be conservative: only flag a signal when the transcript shows it. "
    "Return ONLY a JSON object matching the schema."
)

ANALYSIS_SCHEMA = """{
  "summary": "one or two sentences",
  "intent": "3-8 word noun phrase of what the user wanted, e.g. 'add subtitles to a clip'",
  "outcome": "resolved | partial | unresolved | abandoned",
  "sentiment": "positive | neutral | negative",
  "frustration_score": 0.0,
  "signals": {"frustration": false, "repeated_rephrasing": false, "correction": false,
              "hallucination_suspected": false, "churn_signal": false, "silent_failure": false},
  "feature_requests": ["short canonical phrasing of each distinct feature the user asked for that the assistant said it cannot do"],
  "bug_reports": ["short canonical phrasing of each thing the user says is broken"],
  "evidence": ["<=3 short quotes from the transcript that justify the flags"]
}"""

CLUSTER_SYSTEM = (
    "You name clusters of user conversations with an AI assistant. Return ONLY a JSON object "
    '{"name": "<2-5 words>", "description": "<one sentence>"}.'
)
CLASSIFY_SYSTEM = (
    "You decide whether conversations match a product-team-defined pattern. You receive a pattern name, a plain-English "
    "description and a JSON array of conversations. Return ONLY a JSON array, in the same order, with one object per "
    'conversation: {"match": true|false, "confidence": 0-1, "reason": "..."}.'
)


# ---------------------------------------------------------------- helpers
def extract_json(text: str, array: bool = False):
    """Tolerant JSON extraction: strip code fences, take first opener .. last closer."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    o, c = ("[", "]") if array else ("{", "}")
    a, b = t.find(o), t.rfind(c)
    if a == -1 or b == -1 or b < a:
        raise ValueError(f"no JSON {'array' if array else 'object'} found in model output")
    return json.loads(t[a : b + 1])


def format_transcript(turns: list[dict], max_turns: int = 40, max_chars: int = 12000) -> str:
    turns = turns[-max_turns:]
    lines = [f"[{i}] {t['role'].upper()}: {t['content']}" for i, t in enumerate(turns)]
    text = "\n".join(lines)
    if len(text) > max_chars:
        text = "...(truncated)\n" + text[-max_chars:]
    return text


def fallback_analysis() -> AnalysisResult:
    return AnalysisResult(summary="Analysis failed; transcript could not be parsed.", intent="unparsed", outcome="unresolved")


class LLM:
    name = "base"
    model = "base"

    async def analyze_conversation(self, product_name: str, hints: dict, turns: list[dict]) -> tuple[AnalysisResult, str]:
        raise NotImplementedError

    async def name_cluster(self, top_terms: list[str], sample_intents: list[str]) -> ClusterName:
        raise NotImplementedError

    async def classify_custom(self, name: str, description: str, items: list[dict]) -> list[ClassifyResult]:
        raise NotImplementedError


# ---------------------------------------------------------------- Anthropic
class AnthropicLLM(LLM):
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-sonnet-5-5", client=None):
        self.model = model
        if client is None:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=api_key)
        self.client = client

    async def _complete(self, system: str, user: str, max_tokens: int = 800) -> str:
        resp = await self.client.messages.create(
            model=self.model, max_tokens=max_tokens, temperature=0, system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "text") == "text")

    async def analyze_conversation(self, product_name, hints, turns):
        user = (
            f"Product: {product_name}\n"
            f"Deterministic hints (computed in code): {json.dumps(hints)}\n\n"
            f"Schema:\n{ANALYSIS_SCHEMA}\n\nTranscript (last {len(turns[-40:])} turns):\n{format_transcript(turns)}"
        )
        err = None
        for attempt in range(2):
            prompt = user if err is None else f"{user}\n\nYour previous reply was invalid ({err}). Return ONLY valid JSON matching the schema."
            try:
                raw = await self._complete(ANALYSIS_SYSTEM, prompt, 800)
                return AnalysisResult.model_validate(extract_json(raw)), self.model
            except (ValueError, ValidationError) as e:  # JSONDecodeError is a ValueError
                err = str(e)[:300]
                log.warning("analysis parse failure (attempt %d): %s", attempt + 1, err)
            except Exception as e:  # API/network error: do not crash the batch
                err = f"{type(e).__name__}: {e}"[:300]
                log.warning("analysis API failure (attempt %d): %s", attempt + 1, err)
        return fallback_analysis(), "error"

    async def name_cluster(self, top_terms, sample_intents):
        user = f"Top TF-IDF terms: {', '.join(top_terms[:8])}\nSample intents:\n" + "\n".join(f"- {s}" for s in sample_intents[:6])
        try:
            return ClusterName.model_validate(extract_json(await self._complete(CLUSTER_SYSTEM, user, 200)))
        except Exception as e:
            log.warning("cluster naming failed (%s); using term-based name", e)
            return await MockLLM().name_cluster(top_terms, sample_intents)

    async def classify_custom(self, name, description, items):
        out: list[ClassifyResult] = []
        for start in range(0, len(items), 10):
            batch = items[start : start + 10]
            payload = [
                {"i": i, "summary": it["summary"], "intent": it["intent"], "last_turns": it["last_turns"][-6:]}
                for i, it in enumerate(batch)
            ]
            user = f"Pattern name: {name}\nDescription: {description}\n\nConversations:\n{json.dumps(payload)}"
            res = None
            err = None
            for _ in range(2):
                try:
                    p = user if err is None else f"{user}\n\nPrevious reply invalid ({err}). Return ONLY a JSON array of {len(batch)} objects."
                    arr = extract_json(await self._complete(CLASSIFY_SYSTEM, p, 1200), array=True)
                    if len(arr) != len(batch):
                        raise ValueError(f"expected {len(batch)} items, got {len(arr)}")
                    res = [ClassifyResult.model_validate(a) for a in arr]
                    break
                except Exception as e:
                    err = str(e)[:200]
            out.extend(res or [ClassifyResult(match=False, confidence=0.0, reason="classification failed") for _ in batch])
        return out


# ---------------------------------------------------------------- Mock
FILLER_PREFIX = re.compile(
    r"^(?:(?:hi|hey|hello|yo|ok|okay|so|please|pls|hmm|um)\b[,.!\s]*|(?:can|could|would) you\b\s*(?:please\s*)?|"
    r"i(?:'d| would)? (?:like|want|need) (?:you )?to\s*|help me\s*(?:to\s*)?|i want\s*|is there a way to\s*|"
    r"do you support\s*|does it support\s*|i wish it could\s*)+", re.I)

FEATURE_CONCEPTS = [
    (re.compile(r"subtitl|caption|transcri", re.I), "auto-generate subtitles"),
    (re.compile(r"\b4k\b|2160", re.I), "export in 4K"),
    (re.compile(r"tiktok|vertical|9:16|reels|shorts", re.I), "export vertical video for TikTok"),
    (re.compile(r"dark mode|dark theme", re.I), "dark mode for the editor"),
    (re.compile(r"green screen|chroma", re.I), "green screen removal"),
]
BUG_CONCEPTS = [
    (re.compile(r"export", re.I), "export fails with an error"),
    (re.compile(r"preview|timeline|render", re.I), "preview gets stuck while rendering"),
    (re.compile(r"upload", re.I), "upload fails"),
]


def _clean_phrase(text: str, max_words: int = 10) -> str:
    t = re.sub(r"[^\w\s':/.-]", " ", text.lower())
    t = FILLER_PREFIX.sub("", t.strip()).strip()
    words = t.split()
    return " ".join(words[:max_words]).strip(" .,:;-")


def _intent(text: str) -> str:
    t = re.sub(r"[^\w\s'-]", " ", text.lower()).strip()
    t = FILLER_PREFIX.sub("", t).strip()
    return " ".join(t.split()[:8]) or "unknown"


class MockLLM(LLM):
    name = "mock"
    model = "mock"

    async def analyze_conversation(self, product_name, hints, turns):
        users = [t["content"] for t in turns if t["role"] == "user"]
        first = users[0] if users else ""
        feature_requests, bug_reports, evidence = [], [], []
        correction = churn = hallucination = False
        frustration = any(H.is_frustrated_text(u) for u in users)

        for i, t in enumerate(turns):
            if t["role"] != "user":
                continue
            c = t["content"]
            if H.FEATURE_PHRASES.search(c) and i + 1 < len(turns) and turns[i + 1]["role"] == "assistant" and H.REFUSAL.search(turns[i + 1]["content"]):
                canon = next((label for rx, label in FEATURE_CONCEPTS if rx.search(c)), None)
                if not canon:
                    m = H.FEATURE_PHRASES.search(c)
                    canon = _clean_phrase(c[m.end():]) or _clean_phrase(c)
                if canon and canon not in feature_requests:
                    feature_requests.append(canon)
                    evidence.append(c[:120])
            link_complaint = bool(H.LINK_COMPLAINT.search(c))
            if link_complaint and any(x["role"] == "assistant" and H.URL_RE.search(x["content"]) for x in turns[:i]):
                hallucination = True
                evidence.append(c[:120])
            elif H.BUG_WORDS.search(c) and not link_complaint:
                canon = next((label for rx, label in BUG_CONCEPTS if rx.search(c)), None) or _clean_phrase(c, 8)
                if canon not in bug_reports:
                    bug_reports.append(canon)
                    evidence.append(c[:120])
            if H.CORRECTION.search(c):
                correction = True
                evidence.append(c[:120])
            if H.CHURN.search(c):
                churn = True
                evidence.append(c[:120])

        rephrasing = hints.get("rephrase_count", 0) >= 1
        frustration = frustration or bool(hints.get("profanity_hit"))
        last_user = users[-1] if users else ""
        last_pos = bool(H.POSITIVE_WORDS.search(last_user)) and not H.NEGATIVE_WORDS.search(last_user)
        any_issue = frustration or rephrasing or correction

        if feature_requests or bug_reports or hallucination:
            outcome = "unresolved"
        elif churn:
            outcome = "abandoned"
        elif frustration and hints.get("ended_on_user_turn"):
            outcome = "abandoned"
        elif any_issue:
            outcome = "partial" if last_pos else "unresolved"
        else:
            outcome = "resolved"

        score = 0.05
        if rephrasing or correction:
            score = 0.35
        if frustration:
            score = 0.8
        if churn:
            score = min(1.0, score + 0.1)

        if frustration or churn or outcome in ("abandoned",):
            sentiment = "negative"
        elif last_pos and not any_issue:
            sentiment = "positive"
        else:
            sentiment = "neutral"

        # silent failure: assistant claimed completion, but the user then reacted negatively / asked again
        silent = False
        asst_idx = [i for i, t in enumerate(turns) if t["role"] == "assistant"]
        if asst_idx and outcome != "resolved":
            li = asst_idx[-1]
            if H.SUCCESS_WORDS.search(turns[li]["content"]):
                after = [t["content"] for t in turns[li + 1 :] if t["role"] == "user"]
                silent = bool(after and (H.NEGATIVE_WORDS.search(after[-1]) or H.is_frustrated_text(after[-1]) or H.CORRECTION.search(after[-1]) or rephrasing))

        extra = ""
        if feature_requests:
            extra += " Assistant could not do: " + "; ".join(feature_requests) + "."
        if bug_reports:
            extra += " Reported broken: " + "; ".join(bug_reports) + "."
        summary = f'Asked "{first[:140]}".{extra} Outcome: {outcome}.'
        result = AnalysisResult(
            summary=summary,
            intent=_intent(first),
            outcome=outcome,
            sentiment=sentiment,
            frustration_score=score,
            signals={
                "frustration": frustration, "repeated_rephrasing": rephrasing, "correction": correction,
                "hallucination_suspected": hallucination, "churn_signal": churn, "silent_failure": silent,
            },
            feature_requests=feature_requests,
            bug_reports=bug_reports,
            evidence=evidence[:3],
        )
        return result, "mock"

    async def name_cluster(self, top_terms, sample_intents):
        words = list(dict.fromkeys(w for t in top_terms for w in t.split()))
        top3 = words[:3]
        return ClusterName(name=" ".join(top3) if top3 else "Misc", description="Conversations about: " + ", ".join(top_terms[:5]) + ".")

    async def classify_custom(self, name, description, items):
        want = H.content_words(description) - {"user", "users"}
        results = []
        for it in items:
            have = H.content_words(it["summary"] + " " + it["intent"])
            overlap = want & have
            need = 2 if len(want) >= 2 else 1
            results.append(ClassifyResult(
                match=len(overlap) >= need,
                confidence=round(len(overlap) / max(1, len(want)), 2),
                reason="keyword overlap: " + ", ".join(sorted(overlap)) if overlap else "no keyword overlap",
            ))
        return results


def build_llm() -> LLM:
    s = get_settings()
    provider = s["provider"]
    if provider != "mock" and s["api_key"]:
        llm: LLM = AnthropicLLM(s["api_key"], s["model"])
    else:
        llm = MockLLM()
    log.warning("LLM provider active: %s (model=%s)", llm.name, llm.model)
    print(f"[agnost-clone] LLM provider: {llm.name} (model={llm.model})")
    return llm
