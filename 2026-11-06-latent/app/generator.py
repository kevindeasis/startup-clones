"""Answer generation with a model (base or strong), plus a deterministic mock."""
from __future__ import annotations

from .config import Settings
from .judge import best_overlap_sentence, split_sentences

INSTRUCTION = "Answer the question using only the sources. If the sources do not say, say you do not know."


def build_user_message(question: str, sources: list[str]) -> str:
    src = "\n".join(f"[{i}] {s}" for i, s in enumerate(sources)) or "(no sources provided)"
    return f"SOURCES:\n{src}\n\nQUESTION:\n{question}"


def _source_sentences(sources: list[str]) -> list[str]:
    return [s for src in sources for s in (split_sentences(src) or [src])]


def mock_generate(question: str, sources: list[str]) -> str:
    """Mock base model: first two source sentences joined."""
    sents = _source_sentences(sources)
    return " ".join(sents[:2]) if sents else "I do not know."


def mock_grounded_rewrite(question: str, sources: list[str]) -> str:
    """Mock stronger model: source sentences with highest overlap to the question, in order."""
    sents = _source_sentences(sources)
    if not sents:
        return "I do not know."
    ranked: list[str] = []
    pool = list(sents)
    for _ in range(min(2, len(pool))):
        best = best_overlap_sentence(question, pool)
        assert best is not None
        ranked.append(best)
        pool.remove(best)
    return " ".join(ranked)


def anthropic_generate(settings: Settings, model: str, question: str, sources: list[str]) -> str:
    import anthropic

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.create(
        model=model, max_tokens=500, system=INSTRUCTION,
        messages=[{"role": "user", "content": build_user_message(question, sources)}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


def generate_answer(settings: Settings, question: str, sources: list[str]) -> str:
    if settings.mock_mode:
        return mock_generate(question, sources)
    return anthropic_generate(settings, settings.base_model, question, sources)
