import json
import subprocess
import sys
from pathlib import Path

from rehearsal.grade import evaluate, main
from rehearsal.scenarios import builtin_scenarios, load_scenario_file

ROOT = Path(__file__).resolve().parent.parent
SC = ROOT / "scenarios"


def test_scenarios_load():
    assert set(builtin_scenarios()) == {"refund_happy_path", "refund_flaky_network",
                                        "refund_flaky_network_idempotent", "github_triage"}
    assert load_scenario_file(SC / "refund_flaky_network.yaml").network.drop_after_write.count == 1


def test_cli_happy_path_exit_0(capsys):
    assert main([str(SC / "refund_happy_path.yaml")]) == 0
    out = capsys.readouterr().out
    assert "PASS: 6/6 assertions passed" in out and "FAIL" not in out.replace("PASS: ", "")


def test_cli_flaky_exit_1_and_highlights_refund_count(capsys):
    assert main([str(SC / "refund_flaky_network.yaml")]) == 1
    out = capsys.readouterr().out
    row = next(line for line in out.splitlines() if line.startswith(">>") and "count stripe.refunds" in line)
    assert "== 1" in row and " 2 " in row and "FAIL" in row
    assert out.strip().splitlines()[-1].startswith("FAIL:")


def test_cli_idempotent_and_triage_pass():
    assert main([str(SC / "refund_flaky_network_idempotent.yaml")]) == 0
    assert main([str(SC / "github_triage.yaml")]) == 0


def test_cli_json_output(capsys):
    assert main([str(SC / "refund_flaky_network.yaml"), "--json"]) == 1
    data = json.loads(capsys.readouterr().out)
    assert data["passed"] is False and data["agent"]["mode"] == "mock"
    first = data["assertions"][0]
    assert first["actual"] == 2 and first["expected"] == "== 1" and first["passed"] is False


def test_cli_bad_scenario_exit_2(tmp_path):
    p = tmp_path / "bad.yaml"
    p.write_text("not: [valid")
    assert main([str(p)]) == 2


def test_python_dash_m_entrypoint():
    r = subprocess.run([sys.executable, "-m", "rehearsal.grade", str(SC / "refund_happy_path.yaml")],
                       cwd=ROOT, capture_output=True, text=True, env={**__import__("os").environ, "REHEARSAL_MOCK": "1"})
    assert r.returncode == 0 and "PASS" in r.stdout


def test_grade_endpoint_in_process(live):
    ok = live.http.post("/_sim/grade", json={"scenario": "refund_happy_path"}, timeout=30).json()
    assert ok["passed"] is True
    bad = live.http.post("/_sim/grade", json={"scenario": "refund_flaky_network"}, timeout=30).json()
    assert bad["passed"] is False and bad["assertions"][0]["actual"] == 2
    fixed = live.http.post("/_sim/grade", json={"scenario": "refund_flaky_network", "agent_flags": {"idempotency": True}},
                           timeout=30).json()
    assert fixed["assertions"][0]["passed"] is True and fixed["assertions"][0]["actual"] == 1  # replayed, 1 refund
    assert fixed["passed"] is False  # but the strict calls<=1 assertion still sees the retry POST
    assert live.http.post("/_sim/grade", json={"scenario": "nope"}).status_code == 404


def test_evaluate_assertion_kinds():
    regs = {"r": {"a": {"x": 1, "t": "hello world", "n": {"k": "v"}}, "b": {"x": 2, "t": "bye"}}}
    ledger = [{"service": "stripe", "method": "GET", "path": "/v1/a", "status": 200}]
    egress = [{"type": "e.one", "service": "stripe"}]
    rows = evaluate([
        {"kind": "count", "register": "r", "where": {"x": 1}, "equals": 1},
        {"kind": "count", "register": "r", "gte": 3},
        {"kind": "field", "register": "r", "key": "a", "path": "n.k", "equals": "v"},
        {"kind": "field", "register": "r", "key": "a", "path": "t", "contains": "world"},
        {"kind": "text_contains", "register": "r", "field": "t", "any_contains": ["bye", "zzz"]},
        {"kind": "calls", "where": {"service": "stripe", "path_glob": "/v1/*"}, "equals": 1},
        {"kind": "egress", "where": {"type": "e.one"}, "lte": 0},
        {"kind": "bogus"},
    ], regs, ledger, egress)
    assert [r["passed"] for r in rows] == [True, False, True, True, True, True, False, False]
