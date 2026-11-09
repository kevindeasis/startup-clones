"""Loads rulebook.json (demo legal elements; not legal advice)."""
import json
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load() -> list[dict]:
    return json.loads((Path(__file__).parent / "rulebook.json").read_text(encoding="utf-8"))


def by_id() -> dict[str, dict]:
    return {e["id"]: e for e in load()}


def get(element_id: str) -> dict | None:
    return by_id().get(element_id)


def valid_ids() -> set[str]:
    return set(by_id())


def group_by_law(ids: list[str]) -> list[dict]:
    """Group element ids by law -> [{law, elements:[...]}] preserving rulebook order."""
    out: dict[str, list[dict]] = {}
    for e in load():
        if e["id"] in ids:
            out.setdefault(e["law"], []).append(e)
    return [{"law": k, "elements": v} for k, v in out.items()]


def prompt_text() -> str:
    return "\n".join(f"- {e['id']} [{e['law']}]: {e['description']}" for e in load())
