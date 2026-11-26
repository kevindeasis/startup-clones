from datetime import date

import pytest

from app.compiler import CompileError, compile_interpretation
from app.main import EXAMPLES
from app.models import Filter, Interpretation, TimeRange
from app.verifier import check_invariants, verify_sql


def checks_by_name(res):
    return {c["name"]: c for c in res.checks}


def good_sql(rl, metric, **kw):
    return compile_interpretation(rl, Interpretation(metric=metric, **kw)).sql


# ---------- compiler ----------
def test_compile_revenue_by_month(rl):
    c = compile_interpretation(rl, Interpretation(metric="revenue", group_by=["month"],
                               time_range=TimeRange(start=date(2026, 1, 1), end=date(2027, 1, 1))))
    assert "date_trunc('month', payments.paid_at)" in c.sql.lower()
    assert "payments.status IN ('succeeded', 'refunded')" in c.sql
    assert "invoice_lines" not in c.sql
    assert "succeeded" in c.restatement and "refunded" in c.restatement


def test_compile_customers_injects_predicates(rl):
    c = compile_interpretation(rl, Interpretation(metric="customers", group_by=["plan"],
                               filters=[Filter(dimension="country", op="=", value="CA")]))
    assert "accounts.is_trial = FALSE" in c.sql and "accounts.status <> 'churned'" in c.sql
    assert "accounts.country = 'CA'" in c.sql and "GROUP BY accounts.plan" in c.sql
    assert c.restatement.startswith("Count of distinct accounts that are not trials and not churned, grouped by plan, where country = 'CA'")


def test_compile_mrr_and_restatement_time(rl):
    c = compile_interpretation(rl, Interpretation(metric="mrr", time_range=TimeRange(start=date(2026, 1, 1), end=date(2026, 7, 1))))
    assert "subscriptions.ended_at IS NULL" in c.sql
    assert "from 2026-01-01 up to but not including 2026-07-01" in c.restatement


def test_compile_errors(rl):
    with pytest.raises(CompileError):
        compile_interpretation(rl, Interpretation(metric="nope"))
    with pytest.raises(CompileError):
        compile_interpretation(rl, Interpretation(metric="customers", group_by=["payment_status"]))


# ---------- verifier: one pass + one fail per check ----------
def test_all_checks_pass_for_compiled_query(database, rl):
    res = verify_sql(database, rl, good_sql(rl, "customers", group_by=["plan"]), "customers")
    assert res.passed and len(res.checks) == 7 and res.rows


def test_parses(database, rl):
    assert verify_sql(database, rl, "SELECT 1 FROM accounts", "customers").checks[0]["passed"]
    res = verify_sql(database, rl, "DROP TABLE accounts", "customers")
    assert not checks_by_name(res)["parses"]["passed"]
    res = verify_sql(database, rl, "SELECT COUNT(*) FROM accounts; DELETE FROM accounts", "customers")
    assert not res.checks[0]["passed"]
    assert not verify_sql(database, rl, "SELEC FROM", "customers").checks[0]["passed"]


def test_allowed_tables_columns(database, rl):
    res = verify_sql(database, rl, "SELECT COUNT(DISTINCT accounts.secret) FROM accounts", "customers")
    c = checks_by_name(res)["allowed_tables_columns"]
    assert not c["passed"] and "secret" in c["detail"]
    res = verify_sql(database, rl, "SELECT COUNT(*) FROM users", "customers")
    assert not checks_by_name(res)["allowed_tables_columns"]["passed"]


def test_forbidden_invoice_lines(database, rl):
    sql = "SELECT SUM(invoices.total) FROM invoices JOIN invoice_lines ON invoices.invoice_id = invoice_lines.invoice_id"
    res = verify_sql(database, rl, sql, "revenue")
    assert not res.passed
    assert "forbidden" in checks_by_name(res)["allowed_tables_columns"]["detail"]
    assert not checks_by_name(res)["metric_expression_matches"]["passed"]


def test_missing_is_trial_predicate(database, rl):
    sql = "SELECT COUNT(DISTINCT accounts.account_id) AS customers FROM accounts WHERE accounts.status <> 'churned'"
    res = verify_sql(database, rl, sql, "customers")
    c = checks_by_name(res)
    assert c["metric_expression_matches"]["passed"]
    assert not c["required_predicates_present"]["passed"] and "is_trial" in c["required_predicates_present"]["detail"]
    assert not c["executes"]["passed"]  # unproven queries never execute


def test_wrong_aggregate_expression(database, rl):
    sql = ("SELECT SUM(payments.amount) FROM payments JOIN invoices ON payments.invoice_id = invoices.invoice_id "
           "WHERE payments.status IN ('succeeded','refunded')")
    c = checks_by_name(verify_sql(database, rl, sql, "revenue"))
    assert not c["metric_expression_matches"]["passed"] and "mismatch" in c["metric_expression_matches"]["detail"]


def test_group_by_consistent(database, rl):
    sql = ("SELECT accounts.name, COUNT(DISTINCT accounts.account_id) FROM accounts "
           "WHERE accounts.is_trial = false AND accounts.status <> 'churned' GROUP BY accounts.name")
    c = checks_by_name(verify_sql(database, rl, sql, "customers"))
    assert not c["group_by_consistent"]["passed"]  # name is not a dimension
    sql2 = "SELECT accounts.plan, COUNT(DISTINCT accounts.account_id) FROM accounts WHERE accounts.is_trial = false AND accounts.status <> 'churned'"
    assert not checks_by_name(verify_sql(database, rl, sql2, "customers"))["group_by_consistent"]["passed"]


def test_aliases_and_unqualified_columns_are_normalized(database, rl):
    sql = ("SELECT a.plan, COUNT(DISTINCT a.account_id) FROM accounts a "
           "WHERE a.is_trial = false AND status <> 'churned' GROUP BY a.plan")
    assert verify_sql(database, rl, sql, "customers").passed


def test_invariant_violation(database, rl):
    ok, _ = check_invariants(database, rl, "customers", 5)
    assert ok
    ok, detail = check_invariants(database, rl, "customers", 10_000)
    assert not ok and "customers_not_above_accounts" in detail
    ok, detail = check_invariants(database, rl, "revenue", 1e12)
    assert not ok and "revenue_not_above_gross" in detail


def test_executes_pass_and_fail(database, rl):
    res = verify_sql(database, rl, good_sql(rl, "refunds"), "refunds")
    assert checks_by_name(res)["executes"]["passed"]
    assert len(res.checks) == 7


def test_unknown_metric(database, rl):
    assert not verify_sql(database, rl, "SELECT 1", "bogus").passed


# ---------- end to end ----------
@pytest.mark.parametrize("q", EXAMPLES)
def test_mock_end_to_end_examples(client, q):
    r = client.post("/api/ask", json={"question": q}).json()
    assert r["mock"] is True
    if "NPS" in q:
        assert r["status"] == "unproven" and r["rows"] == [] and r["reason"]
    else:
        assert r["status"] == "proven", r
        assert len(r["checks"]) == 7 and all(c["passed"] for c in r["checks"])
        assert r["rows"] and r["restatement"]


def test_retry_loop(client):
    r = client.post("/api/ask", json={"question": "How many customers do we have including trials?"}).json()
    assert r["status"] == "proven" and len(r["attempts"]) >= 2
    first = {c["name"]: c for c in r["attempts"][0]["checks"]}
    assert not first["required_predicates_present"]["passed"]


def test_revenue_by_month_api(client):
    r = client.post("/api/ask", json={"question": "What was revenue by month in 2026?"}).json()
    assert "succeeded" in r["restatement"] and "refunded" in r["restatement"]
    assert r["columns"] == ["month", "revenue"]


def test_verify_endpoint(client):
    sql = "SELECT SUM(invoices.total) FROM invoices JOIN invoice_lines ON invoices.invoice_id = invoice_lines.invoice_id"
    r = client.post("/api/verify", json={"sql": sql, "metric": "revenue"}).json()
    assert r["passed"] is False and "forbidden" in str(r["checks"])


def test_read_endpoints(client):
    assert client.get("/api/health").json()["mock"] is True
    r = client.get("/api/rules").json()
    assert len(r["metrics"]) >= 7 and len(r["dimensions"]) >= 4 and len(r["invariants"]) >= 4
    s = client.get("/api/schema").json()["tables"]
    assert {t["name"] for t in s} >= {"accounts", "payments"} and all("allowed" in t for t in s)
    assert len(client.get("/api/examples").json()["examples"]) == 8
    assert "Proven" in client.get("/").text


def test_llm_error_becomes_unavailable(client, monkeypatch):
    import anthropic
    import httpx
    from app import llm
    monkeypatch.delenv("PROVEN_MOCK", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    class Boom:
        def __init__(self, *a, **k): ...
        class messages:  # noqa: N801
            @staticmethod
            def parse(**k):
                raise anthropic.APIConnectionError(request=httpx.Request("POST", "http://x"))
    monkeypatch.setattr(llm.anthropic, "Anthropic", Boom)
    r = client.post("/api/ask", json={"question": "revenue"})
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "unproven" and "LLM unavailable" in j["reason"] and j["rows"] == []


def test_subquery_rejected(database, rl):
    sql = ("SELECT COUNT(DISTINCT accounts.account_id) FROM accounts WHERE accounts.is_trial = false "
           "AND accounts.status <> 'churned' AND accounts.account_id IN (SELECT account_id FROM invoice_lines)")
    res = verify_sql(database, rl, sql, "customers")
    assert not res.passed
    d = checks_by_name(res)["parses"]["detail"]
    assert not checks_by_name(res)["parses"]["passed"] and "nested SELECT" in d


def test_unexplained_predicate_named(database, rl):
    sql = ("SELECT COUNT(DISTINCT accounts.account_id) FROM accounts WHERE accounts.is_trial = false "
           "AND accounts.status <> 'churned' AND accounts.account_id > 5")
    c = checks_by_name(verify_sql(database, rl, sql, "customers"))["required_predicates_present"]
    assert not c["passed"] and "account_id > 5" in c["detail"]


def test_or_in_where_rejected(database, rl):
    sql = ("SELECT COUNT(DISTINCT accounts.account_id) FROM accounts WHERE accounts.is_trial = false "
           "AND accounts.status <> 'churned' AND (accounts.country = 'CA' OR accounts.country = 'US')")
    c = checks_by_name(verify_sql(database, rl, sql, "customers"))["required_predicates_present"]
    assert not c["passed"] and "OR" in c["detail"]


def test_filtered_compiled_query_passes(database, rl):
    sql = good_sql(rl, "customers", group_by=["plan"], filters=[Filter(dimension="country", op="=", value="CA")],
                   time_range=TimeRange(start=date(2025, 1, 1), end=date(2027, 1, 1)))
    assert verify_sql(database, rl, sql, "customers").passed
    r = verify_sql(database, rl, good_sql(rl, "revenue", group_by=["month"]), "revenue")
    assert r.passed and r.rows[0][0] == "2025-01-01"


def test_canada_question_end_to_end(client):
    r = client.post("/api/ask", json={"question": "How many customers do we have by plan in Canada?"}).json()
    assert r["status"] == "proven" and "country = 'CA'" in r["restatement"]
