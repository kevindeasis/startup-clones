"""Network-profile middleware: latency, refused requests, rate limits, drop-after-write, ledger."""
from __future__ import annotations

import asyncio
import hashlib
import math
import random
import re
import time
from fnmatch import fnmatch

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .envs import CUR_MUT, Env

PATH_RE = re.compile(r"^/e/([^/]+)/(stripe|slack|github)(/.*)?$")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def fault_response(service: str, kind: str, retry_after: int = 60) -> JSONResponse:
    if kind == "refused":
        status = 503
        body = {
            "stripe": {"error": {"type": "api_error", "message": "The service is temporarily unavailable (simulated refusal)."}},
            "slack": {"ok": False, "error": "service_unavailable"},
            "github": {"message": "Service Unavailable (simulated refusal)"},
        }[service]
        return JSONResponse(body, status_code=status)
    body = {
        "stripe": {"error": {"type": "rate_limit_error", "code": "rate_limit", "message": "Too many requests hit the API too quickly."}},
        "slack": {"ok": False, "error": "ratelimited"},
        "github": {"message": "API rate limit exceeded", "documentation_url": "https://docs.github.com/rest"},
    }[service]
    return JSONResponse(body, status_code=429, headers={"Retry-After": str(retry_after)})


class SimMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        m = PATH_RE.match(request.url.path)
        if not m:
            return await call_next(request)
        env: Env | None = request.app.state.registry.get(m.group(1))
        if env is None:
            return JSONResponse({"error": "env_not_found", "message": f"No such env: {m.group(1)}"}, status_code=404)
        service, path = m.group(2), m.group(3) or "/"
        method = request.method
        body = await request.body()
        digest = hashlib.sha256(f"{method} {path}?{request.url.query}\n".encode() + body).hexdigest()[:16]
        t = env.now_iso()
        net = env.network
        n_gh = env.next("github.calls") if service == "github" else 0
        fault: str | None = None
        latency = 0
        short: JSONResponse | None = None
        if net.enabled:
            n = env.next("net.requests")
            rnd = random.Random(f"{env.rng_seed}:net:{n}")
            latency = net.latency_ms + (rnd.randint(0, net.jitter_ms) if net.jitter_ms else 0)
            if net.refuse_fraction > 0 and random.Random(f"{env.rng_seed}:refuse:{n}").random() < net.refuse_fraction:
                fault, short = "refused", fault_response(service, "refused")
            elif net.rate_limit:
                now = time.monotonic()
                env.rate_window[:] = [x for x in env.rate_window if now - x < 60]
                if len(env.rate_window) >= net.rate_limit.requests_per_minute:
                    wait = max(1, math.ceil(60 - (now - env.rate_window[0])))
                    fault, short = "rate_limited", fault_response(service, "rate_limited", wait)
                else:
                    env.rate_window.append(now)
            if latency:
                await asyncio.sleep(latency / 1000)
                if fault is None:
                    fault = "latency"
        muts: list[str] = []
        token = CUR_MUT.set(muts)
        try:
            response = short if short is not None else await call_next(request)
            drop = net.drop_after_write if net.enabled else None
            if (short is None and drop and method in WRITE_METHODS and response.status_code < 400
                    and drop.service == service and fnmatch(path, drop.path_glob) and drop.dropped < drop.count):
                # The mutation is already applied; the client never gets the real response.
                drop.dropped += 1
                fault = "dropped_after_write"
                response = Response("Internal Server Error", status_code=500, media_type="text/plain",
                                    headers={"Connection": "close"})
        finally:
            CUR_MUT.reset(token)
        env.ledger.append({
            "seq": len(env.ledger) + 1, "t": t, "service": service, "method": method, "path": path,
            "status": response.status_code, "latency_ms": latency, "fault": fault,
            "request_digest": digest, "mutations": muts,
        })
        if service == "github":
            response.headers["X-RateLimit-Limit"] = "5000"
            response.headers["X-RateLimit-Remaining"] = str(max(0, 5000 - n_gh))
            response.headers["X-RateLimit-Reset"] = str(env.epoch() + 3600)
        if service == "stripe":
            response.headers["Request-Id"] = f"req_{digest}"
        return response
