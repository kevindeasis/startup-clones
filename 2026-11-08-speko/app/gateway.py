"""Stage execution with failover across the ranked list."""
import time

from . import config, health
from .providers import ProviderError, get_provider
from .routing import rank_providers


class AllProvidersFailed(Exception):
    def __init__(self, stage, attempts):
        super().__init__(f"all providers failed for stage '{stage}'")
        self.stage, self.attempts = stage, attempts


def execute_stage(stage, language, use_case, priority, *, audio=None, text=None) -> tuple[object, dict]:
    ranking = rank_providers(stage, language, use_case, priority)
    candidates = [e["provider"] for e in ranking["ranked"] if not e["circuit_open"]]
    skipped = [e["provider"] for e in ranking["ranked"] if e["circuit_open"]]
    attempts = []
    t0 = time.perf_counter()
    for name in candidates[:config.MAX_ATTEMPTS]:
        fault = health.get_state(name)["fault_mode"]
        try:
            if fault == "fail":
                raise ProviderError("injected fault: provider unavailable")
            res = get_provider(name).call(language=language, audio=audio, text=text, use_case=use_case)
            latency = res.latency_ms + (config.SLOW_PENALTY_MS if fault == "slow" else 0.0)
        except Exception as e:  # provider raised / timed out
            msg = f"{type(e).__name__}: {e}"[:300]
            health.record_failure(name, msg)
            attempts.append({"provider": name, "ok": False, "error": msg})
            continue
        health.record_success(name)
        attempts.append({"provider": name, "ok": True, "error": None})
        trace = {"stage": stage, "provider": name, "latency_ms": round(latency, 1),
                 "cost_usd": round(res.cost_usd, 8), "attempts": attempts, "skipped_open_circuit": skipped,
                 "fallback_used": len(attempts) > 1, "wall_ms": round((time.perf_counter() - t0) * 1000, 1)}
        return res.output, trace
    raise AllProvidersFailed(stage, attempts)
