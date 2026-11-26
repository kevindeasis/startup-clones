"""Loads rules.yaml (the semantic layer) and exposes typed helpers."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent


class Rules:
    def __init__(self, raw: dict[str, Any]):
        self.raw = raw
        self.tables: dict[str, list[str]] = {t.lower(): [c.lower() for c in cols] for t, cols in raw["tables"].items()}
        self.dimensions: dict[str, dict] = {d["name"]: d for d in raw["dimensions"]}
        self.metrics: dict[str, dict] = {m["name"]: m for m in raw["metrics"]}
        self.invariants: dict[str, dict] = {i["name"]: i for i in raw["invariants"]}

    def metric_tables(self, metric: str) -> list[str]:
        m = self.metrics[metric]
        out = [m["base"]]
        for j in m.get("joins", []):
            out.append(j.split()[0])
        return out


@lru_cache(maxsize=1)
def load_rules(path: str | None = None) -> Rules:
    p = Path(path or os.environ.get("PROVEN_RULES", ROOT / "rules.yaml"))
    with open(p) as f:
        return Rules(yaml.safe_load(f))
