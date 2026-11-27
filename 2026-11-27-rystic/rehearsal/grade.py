"""Scenario runner + deterministic assertion evaluator + CLI.

    python -m rehearsal.grade scenarios/refund_happy_path.yaml [--json] [--mock] [--base URL]
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
from fnmatch import fnmatch
from typing import Any

import httpx

from .agent.support_agent import run_agent
from .envs import Registry
from .scenarios import Scenario, apply_scenario, load_scenario_file


def _get(rec: Any, path: str) -> Any:
    cur = rec
    for part in str(path).split("."):
        cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def _matches(rec: dict, where: dict) -> bool:
    return all(_get(rec, k) == v for k, v in where.items())


def _compare(actual: Any, a: dict, default_gte: int | None = None) -> tuple[bool, str]:
    checks = []
    for op, sym, fn in (("equals", "==", lambda x, y: x == y), ("gte", ">=", lambda x, y: x is not None and x >= y),
                        ("lte", "<=", lambda x, y: x is not None and x <= y)):
        if op in a:
            checks.append((sym, a[op], fn(actual, a[op])))
    if "contains" in a:
        want = a["contains"]
        ok = (want in actual) if isinstance(actual, (str, list, dict)) else False
        checks.append(("contains", want, ok))
    if not checks and default_gte is not None:
        checks.append((">=", default_gte, actual >= default_gte))
    expected = " and ".join(f"{s} {v}" for s, v, _ in checks) or "(no comparator)"
    return bool(checks) and all(ok for _, _, ok in checks), expected


def _fmt_where(w: dict) -> str:
    return "{" + ", ".join(f"{k}={v}" for k, v in w.items()) + "}" if w else ""


def evaluate(assertions: list[dict], registers: dict, ledger: list[dict], egress: list[dict]) -> list[dict]:
    rows = []
    for a in assertions:
        kind, where = a.get("kind"), a.get("where", {}) or {}
        try:
            if kind == "count":
                reg = a["register"]
                actual = sum(1 for r in registers.get(reg, {}).values() if _matches(r, where))
                label = f"count {reg} {_fmt_where(where)}"
                ok, exp = _compare(actual, a)
            elif kind == "field":
                rec = registers.get(a["register"], {}).get(a["key"])
                actual = _get(rec, a["path"]) if rec is not None else None
                label = f"field {a['register']}[{a['key']}].{a['path']}"
                ok, exp = _compare(actual, a)
            elif kind == "text_contains":
                reg, fld = a["register"], a.get("field", "text")
                needles = a.get("any_contains", [])
                actual = sum(1 for r in registers.get(reg, {}).values() if _matches(r, where)
                             and any(n in str(_get(r, fld) or _get(r, "body") or "") for n in needles))
                label = f"text {reg} {_fmt_where(where)} contains any of {needles}"
                ok, exp = _compare(actual, a, default_gte=1)
            elif kind == "calls":
                w = dict(where)
                glob = w.pop("path_glob", None)
                actual = sum(1 for c in ledger if _matches(c, w) and (glob is None or fnmatch(c["path"], glob)))
                label = f"calls {_fmt_where(where)}"
                ok, exp = _compare(actual, a)
            elif kind == "egress":
                actual = sum(1 for e in egress if _matches(e, where))
                label = f"egress {_fmt_where(where)}"
                ok, exp = _compare(actual, a)
            else:
                raise ValueError(f"unknown assertion kind: {kind}")
        except (KeyError, ValueError, TypeError) as exc:
            label, exp, actual, ok = f"{kind} (invalid)", "-", f"error: {exc!r}", False
        rows.append({"assertion": label.strip(), "expected": exp, "actual": actual, "passed": ok})
    return rows


def _agent_args(sc: Scenario, extra_flags: list[str]) -> dict:
    flags = list(sc.agent.flags) + list(extra_flags)
    return {"task": sc.agent.task, "idempotency": "--idempotency" in flags, "mock": True if "--mock" in flags else None}


def _result(sc: Scenario, env_id: str, report, rows: list[dict]) -> dict:
    failed = [r for r in rows if not r["passed"]]
    passed = not failed
    verdict = (f"PASS: {len(rows)}/{len(rows)} assertions passed" if passed
               else f"FAIL: {len(failed)}/{len(rows)} assertions failed")
    return {"scenario": sc.name, "description": sc.description, "env_id": env_id, "passed": passed,
            "verdict": verdict, "agent": report.as_dict(), "assertions": rows}


def run_scenario_against(base: str, registry: Registry, sc: Scenario, extra_flags: list[str] | None = None,
                         mock: bool | None = None) -> dict:
    """Boot a fresh env in `registry`, run the agent against `base`, grade the resulting state."""
    env = registry.create()
    apply_scenario(env, sc)
    env.boot = {"scenario": sc.name, "seed": None}
    kw = _agent_args(sc, extra_flags or [])
    if mock:
        kw["mock"] = True
    report = run_agent(base, env.env_id, **kw)
    rows = evaluate(sc.assertions, env.registers, env.ledger, env.egress)
    return _result(sc, env.env_id, report, rows)


def run_scenario_remote(base: str, sc: Scenario, extra_flags: list[str] | None = None, mock: bool | None = None) -> dict:
    """Same, against an already-running external server (scenario must be built in)."""
    with httpx.Client(base_url=base, timeout=15) as http:
        r = http.post("/_sim/envs", json={"scenario": sc.name})
        r.raise_for_status()
        env_id = r.json()["env_id"]
        kw = _agent_args(sc, extra_flags or [])
        if mock:
            kw["mock"] = True
        report = run_agent(base, env_id, **kw)
        regs = http.get(f"/_sim/envs/{env_id}/inspect").json()["registers"]
        ledger = http.get(f"/_sim/envs/{env_id}/calls").json()["calls"]
        egress = http.get(f"/_sim/envs/{env_id}/egress").json()["events"]
    return _result(sc, env_id, report, evaluate(sc.assertions, regs, ledger, egress))


class ServerThread:
    """Runs a fresh Rehearsal app in a background uvicorn thread on a free port."""

    def __init__(self) -> None:
        import uvicorn
        from .server import create_app

        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.app = create_app()
        self.server = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "ServerThread":
        self.thread.start()
        for _ in range(100):
            if self.server.started:
                return self
            time.sleep(0.05)
        raise RuntimeError("server did not start")

    def __exit__(self, *exc) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)


def format_table(result: dict) -> str:
    rows = [("assertion", "expected", "actual", "result")] + [
        (r["assertion"], r["expected"], str(r["actual"]), "PASS" if r["passed"] else "FAIL") for r in result["assertions"]]
    w = [max(len(r[i]) for r in rows) for i in range(4)]
    lines = []
    for i, r in enumerate(rows):
        line = "  ".join(c.ljust(w[j]) for j, c in enumerate(r)).rstrip()
        if i > 0 and r[3] == "FAIL":
            line = ">> " + line
        else:
            line = "   " + line
        lines.append(line)
        if i == 0:
            lines.append("   " + "  ".join("-" * x for x in w))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m rehearsal.grade", description="Run a scenario and grade the agent")
    ap.add_argument("scenario", help="path to a scenario YAML file")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    ap.add_argument("--mock", action="store_true", help="force the deterministic mock agent")
    ap.add_argument("--base", help="use an already-running server instead of booting one (scenario must be built in)")
    a = ap.parse_args(argv)
    try:
        sc = load_scenario_file(a.scenario)
    except Exception as exc:  # noqa: BLE001
        print(f"error: cannot load scenario: {exc}", file=sys.stderr)
        return 2
    try:
        if a.base:
            result = run_scenario_remote(a.base, sc, mock=a.mock)
        else:
            with ServerThread() as srv:
                result = run_scenario_against(srv.base, srv.app.state.registry, sc, mock=a.mock)
    except Exception as exc:  # noqa: BLE001
        print(f"error: run failed: {exc!r}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        ag = result["agent"]
        print(f"scenario: {sc.name}  - {sc.description}")
        print(f"agent: mode={ag['mode']} steps={ag['steps']} tool_calls={len(ag['tool_calls'])} stop={ag['stop_reason']}")
        for i, tc in enumerate(ag["tool_calls"], 1):
            print(f"  {i:>2}. {tc['name']}  {'ok' if tc['ok'] else 'ERROR ' + str(tc.get('error', ''))[:80]}")
        print()
        print(format_table(result))
        print()
        print(result["verdict"])
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
