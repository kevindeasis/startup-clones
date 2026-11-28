"""End-to-end Steer demo.

    STEER_MOCK=1 python -m examples.demo --serve            # starts the server in a thread
    python -m examples.demo --api-url http://localhost:8790  # against a running server

Exit code 0 only if treatment success rate > holdout success rate and the mistake repeats less in treatment.
"""
import argparse
import os
import socket
import sys
import threading
import time

import httpx

from examples.support_agent import run_batch, success_rate
from steer_sdk import Steer


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(port: int):
    import uvicorn
    from steer.db import Database
    from steer.server import create_app
    app = create_app(db=Database(":memory:"))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/healthz", timeout=0.5).status_code == 200:
                return server, th
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("server did not start")


def pct(x):
    return "n/a" if x is None else f"{x:.0%}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="start the Steer server in a thread")
    ap.add_argument("--port", type=int, default=int(os.environ.get("STEER_PORT", "8790")))
    ap.add_argument("--api-url", default=None)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--baseline", type=int, default=40)
    ap.add_argument("--after", type=int, default=60)
    a = ap.parse_args(argv)
    key = os.environ.get("STEER_API_KEY", "dev")
    server = th = None
    if a.serve:
        port = a.port or free_port()
        server, th = start_server(port)
        api = f"http://127.0.0.1:{port}"
    else:
        api = a.api_url or os.environ.get("STEER_API_URL", "http://localhost:8790")
    h = {"X-Steer-Key": key}
    t0 = time.time()

    def call(method, path, **kw):
        r = httpx.request(method, api + path, headers=h, timeout=30, **kw)
        r.raise_for_status()
        return r.json()

    try:
        print(f"Steer demo against {api} (mock={httpx.get(api + '/healthz').json()['mock']})")
        agent = call("POST", "/v1/agents", json={"name": "support-bot", "mode": "shadow"})
        aid = agent["id"]
        steer = Steer(api, key, aid, timeout_ms=2000)
        print(f"agent {aid} created in shadow mode")

        base = run_batch(steer, a.baseline, a.seed, "baseline")
        print(f"\n[1] baseline: {len(base)} conversations, success rate {pct(success_rate(base))}")

        found = call("POST", f"/v1/agents/{aid}/discover", json={"max_turns": 200})
        print(f"\n[2] discovered {len(found['mistakes'])} recurring mistakes (source={found['source']}):")
        for m in found["mistakes"]:
            print(f"    - {m['title']} ({len(m['evidence'])} turns)")
        disc = next((m for m in found["mistakes"] if "discount" in m["title"].lower()), None)
        assert disc, "discount mistake was not discovered"
        g = disc["suggested_guidance"].lower()
        assert "already declined" in g and "do not offer" in g, "unexpected suggested guidance"

        cor = call("POST", "/v1/corrections", json={"agentId": aid, "title": disc["title"],
                                                      "guidance": disc["suggested_guidance"],
                                                      "trigger": disc["suggested_trigger"]})
        pv = call("POST", f"/v1/corrections/{cor['id']}/preview")
        c = pv["counts"]
        print(f"\n[3] preview of {cor['id']}: matched {c['matched']} turns in {c['matched_conversations']} "
              f"conversations, {c['exclusions']} near-miss exclusions, {len(pv['conflicts'])} conflicts")

        call("POST", f"/v1/corrections/{cor['id']}/activate", json={"holdout_pct": 50})
        call("PATCH", f"/v1/agents/{aid}", json={"mode": "active"})
        print("\n[4] activated with 50% holdout; agent mode -> active")

        after = run_batch(steer, a.after, a.seed + 1, "after")
        print(f"\n[5] after: {len(after)} conversations, overall success rate {pct(success_rate(after))}")

        rep = call("GET", f"/v1/corrections/{cor['id']}/report")
        t, ho, rp = rep["treatment"], rep["holdout"], rep["still_repeating_by_group"]
        print("\n[6] report")
        print(f"    {'group':<10}{'convs':>7}{'success':>9}{'rate':>7}{'still repeating':>18}")
        print(f"    {'treatment':<10}{t['conversations']:>7}{t['successes']:>9}{pct(t['rate']):>7}{rp['treatment']:>18}")
        print(f"    {'holdout':<10}{ho['conversations']:>7}{ho['successes']:>9}{pct(ho['rate']):>7}{rp['holdout']:>18}")
        print(f"    lift: {pct(rep['lift'])}   deliveries: {rep['deliveries']}   "
              f"elapsed: {time.time() - t0:.1f}s")
        ok = (t["rate"] is not None and ho["rate"] is not None and t["rate"] > ho["rate"]
              and rp["treatment"] < rp["holdout"])
        print("\nRESULT:", "PASS (treatment > holdout)" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        if server:
            server.should_exit = True
            th.join(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
