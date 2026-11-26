"""Interpretation step. Real Claude call when a key is present; mock otherwise."""
from __future__ import annotations

import json
import os

import anthropic

from . import mock_llm
from .models import Interpretation
from .rules import Rules

DEFAULT_MODEL = "claude-opus-5-5"


class LLMUnavailable(Exception):
    pass


def model_name() -> str:
    return os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL


def is_mock() -> bool:
    return bool(os.environ.get("PROVEN_MOCK")) or not os.environ.get("ANTHROPIC_API_KEY")


def build_system(rules: Rules, values: dict[str, list]) -> str:
    lines = ["You turn a business question into a structured interpretation. You never write SQL.",
             "Pick exactly one metric. Use group_by for 'by X' breakdowns, filters for restrictions, and time_range",
             "(start inclusive, end exclusive, ISO dates) for date ranges. Data covers 2025-01 to 2026-11.",
             "If the question cannot be answered by any metric, set cannot_answer to a short reason and fill nothing else.",
             "Do not try to remove business-rule predicates (e.g. excluding trials) via filters; the verifier rejects that.",
             "", "METRICS:"]
    lines += [f"- {m['name']}: {m['english']} (dates: {m['date_label']})" for m in rules.metrics.values()]
    lines += ["", "DIMENSIONS (group_by / filters; 'month' is group_by only):"]
    for d in rules.dimensions.values():
        v = f" allowed values: {', '.join(map(str, values[d['name']]))}" if d["name"] in values else ""
        lines.append(f"- {d['name']} ({d['kind']}){v}")
    return "\n".join(lines)


def interpret(rules: Rules, values: dict[str, list], question: str, failures: list[str] | None = None) -> Interpretation:
    if is_mock():
        return mock_llm.interpret(question, failures)
    content = question
    if failures:
        content += "\n\nYour previous interpretation failed verification. Fix it. Failures:\n" + "\n".join(f"- {f}" for f in failures)
    try:
        client = anthropic.Anthropic()
        response = client.messages.parse(
            model=model_name(), max_tokens=2048, system=build_system(rules, values),
            messages=[{"role": "user", "content": content}], output_format=Interpretation)
        parsed = getattr(response, "parsed_output", None)
        if parsed is None:
            text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
            parsed = Interpretation.model_validate(json.loads(text))
        return parsed
    except anthropic.APIError as e:
        raise LLMUnavailable(f"LLM unavailable: {e}") from e
    except (ValueError, StopIteration) as e:  # bad JSON / schema from the model
        raise LLMUnavailable(f"LLM unavailable: could not parse model output ({e})") from e
