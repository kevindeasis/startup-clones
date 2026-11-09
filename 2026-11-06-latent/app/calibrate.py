"""Threshold recalibration: sweep thresholds, maximise F1 (positive = confirmed)."""
from __future__ import annotations

from typing import Any

MIN_LABELED = 5


def _prf(scores: list[float], labels: list[bool], t: float) -> tuple[float, float, float]:
    tp = sum(1 for s, y in zip(scores, labels) if s >= t and y)
    fp = sum(1 for s, y in zip(scores, labels) if s >= t and not y)
    fn = sum(1 for s, y in zip(scores, labels) if s < t and y)
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f1


def calibrate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    scores = [float(r["score"]) for r in rows]
    labels = [r["review_status"] == "confirmed" for r in rows]
    grid = [round(0.05 * i, 2) for i in range(1, 20)]  # 0.05 .. 0.95
    results = [(t, *_prf(scores, labels, t)) for t in grid]
    best_f1 = max(r[3] for r in results)
    tied = [r for r in results if abs(r[3] - best_f1) < 1e-12]
    t, p, r, _ = tied[len(tied) // 2]  # middle of the tied plateau
    return {"threshold": t, "labeled_count": len(rows), "precision": round(p, 4), "recall": round(r, 4)}
