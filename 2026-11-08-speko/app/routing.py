"""Routing: weighted normalized quality/latency/cost scoring over benchmark data."""
import math

from . import health
from .benchmarks import latest_rows
from .providers import list_providers

BASE_WEIGHTS = {  # (quality, latency, cost)
    "quality": (0.80, 0.10, 0.10),
    "latency": (0.10, 0.80, 0.10),
    "cost": (0.10, 0.10, 0.80),
    "balanced": (0.40, 0.30, 0.30),
}
USE_CASE_BIAS = {
    "general": (0, 0, 0),
    "support_call": (0.20, -0.05, -0.05),      # favors quality
    "realtime_voice": (-0.05, 0.20, -0.05),   # favors latency
    "transcription": (0.20, -0.10, -0.05),
    "ivr": (-0.10, 0.0, 0.20),                  # favors cost
}


def weights_for(priority: str, use_case: str) -> dict:
    w = [max(0.02, a + b) for a, b in zip(BASE_WEIGHTS[priority], USE_CASE_BIAS[use_case])]
    s = sum(w)
    return {"quality": round(w[0] / s, 4), "latency": round(w[1] / s, 4), "cost": round(w[2] / s, 4)}


def _norm(v, lo, hi, higher_better):
    if hi - lo < 1e-12:
        return 1.0
    x = (v - lo) / (hi - lo)
    return x if higher_better else 1.0 - x


def rank_providers(stage, language, use_case="general", priority="balanced") -> dict:
    w = weights_for(priority, use_case)
    data = {r["provider"]: r for r in latest_rows(stage, language)}
    states = {s["provider"]: s for s in health.all_states()}
    q = [r["metric_quality"] for r in data.values()]
    l = [r["latency_ms"] for r in data.values()]
    c = [r["cost_usd"] for r in data.values()]
    lc = [math.log10(max(x, 1e-12)) for x in c]
    lmin, lmax = (min(lc), max(lc)) if lc else (0, 0)
    ranked = []
    for p in list_providers(stage):
        st = states.get(p.name, {})
        entry = {"provider": p.name, "has_data": p.name in data, "circuit_open": bool(st.get("circuit_open")),
                 "fault_mode": st.get("fault_mode", "ok")}
        if p.name in data:
            r = data[p.name]
            nq = _norm(r["metric_quality"], min(q), max(q), True)
            nl = _norm(r["latency_ms"], min(l), max(l), False)
            nc = _norm(math.log10(max(r["cost_usd"], 1e-12)), lmin, lmax, False)  # log scale: prices span orders of magnitude
            entry.update(score=round(w["quality"] * nq + w["latency"] * nl + w["cost"] * nc, 4),
                         breakdown={"quality": round(nq, 4), "latency": round(nl, 4), "cost": round(nc, 4),
                                    "weighted": {"quality": round(w["quality"] * nq, 4),
                                                 "latency": round(w["latency"] * nl, 4),
                                                 "cost": round(w["cost"] * nc, 4)}},
                         raw={"quality": r["metric_quality"], "wer": r["wer"], "latency_ms": r["latency_ms"],
                              "cost_usd": r["cost_usd"]})
        else:
            entry.update(score=0.0, breakdown=None, raw=None)
        ranked.append(entry)
    ranked.sort(key=lambda e: (not e["has_data"], -e["score"], e["provider"]))
    for i, e in enumerate(ranked, 1):
        e["rank"] = i
    selected = next((e["provider"] for e in ranked if not e["circuit_open"]), None)
    return {"stage": stage, "language": language, "use_case": use_case, "priority": priority,
            "weights": w, "ranked": ranked, "selected": selected}
