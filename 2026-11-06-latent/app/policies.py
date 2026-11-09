"""Intervention policies applied to flagged answers."""
from __future__ import annotations

from .config import Settings
from .generator import anthropic_generate, mock_grounded_rewrite


def ask_stronger_model(settings: Settings, prompt: str, sources: list[str]) -> str:
    if settings.mock_mode:
        return mock_grounded_rewrite(prompt, sources)
    return anthropic_generate(settings, settings.strong_model, prompt, sources)


def apply_policy(
    settings: Settings, flagged: bool, policy: str, prompt: str, answer: str, sources: list[str]
) -> tuple[str, str]:
    """Return (action, final_answer)."""
    if not flagged:
        return "passed", answer
    if policy == "hold":
        return "held", settings.fallback_text
    if policy == "escalate":
        try:
            stronger = ask_stronger_model(settings, prompt, sources)
        except Exception:  # fail safe: never ship the flagged answer if escalation breaks
            return "escalated", settings.fallback_text
        return "escalated", stronger or settings.fallback_text
    return "delivered", answer
