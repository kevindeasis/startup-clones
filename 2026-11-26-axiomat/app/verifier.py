"""Deterministic semantic-layer verifier. A query is 'proven' only if all 7 checks pass."""
from __future__ import annotations

from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import SqlglotError
from sqlglot.optimizer.simplify import simplify

from .compiler import dimension_expr
from .db import Database
from .rules import Rules

D = "duckdb"
CHECK_NAMES = ["parses", "allowed_tables_columns", "metric_expression_matches",
               "required_predicates_present", "group_by_consistent", "invariants_hold", "executes"]


@dataclass
class VerifyResult:
    checks: list[dict]
    columns: list[str] = field(default_factory=list)
    rows: list[list] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c["passed"] for c in self.checks)

    def failures(self) -> list[str]:
        return [f"{c['name']}: {c['detail']}" for c in self.checks if not c["passed"]]


def _c(name, passed, detail):
    return {"name": name, "passed": bool(passed), "detail": detail}


def _norm_columns(node: exp.Expression) -> exp.Expression:
    for col in node.find_all(exp.Column):
        col.set("this", exp.to_identifier(col.name.lower()))
        if col.table:
            col.set("table", exp.to_identifier(col.table.lower()))
    return node


def canon(e: exp.Expression) -> str:
    e = e.copy()
    while isinstance(e, (exp.Alias, exp.Paren)):
        e = e.this
    e = _norm_columns(e)
    try:
        e = simplify(e)
    except Exception:
        pass
    return e.sql(dialect=D, normalize=True)


def conjuncts(e: exp.Expression) -> list[exp.Expression]:
    if isinstance(e, exp.Paren):
        return conjuncts(e.this)
    if isinstance(e, exp.And):
        return conjuncts(e.left) + conjuncts(e.right)
    return [e]


def analyze(stmt: exp.Select, rules: Rules):
    """Resolve aliases/unqualified columns against the allowed schema.
    Returns (normalized copy, errors, set of real table names)."""
    errors: list[str] = []
    s = stmt.copy()
    alias_map: dict[str, str] = {}
    for t in s.find_all(exp.Table):
        if not isinstance(t.this, exp.Identifier):
            errors.append(f"table function or expression '{t.sql(dialect=D)}' is not allowed")
            continue
        name = t.name.lower()
        alias_map[(t.alias or t.name).lower()] = name
        if name not in rules.tables:
            errors.append(f"table '{t.name}' is not in the allowed schema")
    real = set(alias_map.values())
    if list(s.find_all(exp.Star)):
        errors.append("SELECT * is not allowed; name the columns")
    sel_aliases = {p.alias.lower() for p in s.expressions if isinstance(p, exp.Alias)}
    for col in list(s.find_all(exp.Column)):
        cname = col.name.lower()
        if col.table:
            t = alias_map.get(col.table.lower())
            if t is None:
                errors.append(f"unknown table or alias '{col.table}' for column '{col.name}'")
            elif t in rules.tables and cname not in rules.tables[t]:
                errors.append(f"unknown column '{t}.{cname}'")
            elif t in rules.tables:
                col.set("table", exp.to_identifier(t))
        else:
            cands = [t for t in sorted(real) if cname in rules.tables.get(t, [])]
            if len(cands) == 1:
                col.set("table", exp.to_identifier(cands[0]))
            elif len(cands) > 1:
                errors.append(f"ambiguous column '{cname}' (in {', '.join(cands)}); qualify it")
            elif cname not in sel_aliases:
                errors.append(f"unknown column '{cname}'")
    return s, errors, real


def _canonical_metric(rules: Rules, metric: str):
    m = rules.metrics[metric]
    sql = f"SELECT {m['sql']} FROM {m['base']}" + "".join(f" JOIN {j}" for j in m.get("joins", []))
    return sqlglot.parse_one(sql, dialect=D)


def check_invariants(db: Database, rules: Rules, metric: str, total: float) -> tuple[bool, str]:
    for name in rules.metrics[metric].get("invariants", []):
        inv = rules.invariants[name]
        sql = "SELECT " + inv["check"].replace("{query_total}", repr(float(total)))
        try:
            ok = db.scalar(sql)
        except Exception as e:  # noqa: BLE001
            return False, f"invariant '{name}' could not be evaluated: {e}"
        if not ok:
            return False, f"invariant '{name}' violated (query total {total}): {inv['english']}"
    return True, f"{len(rules.metrics[metric].get('invariants', []))} invariant(s) hold"


def verify_sql(db: Database, rules: Rules, sql: str, metric: str) -> VerifyResult:
    if metric not in rules.metrics:
        names = ", ".join(rules.metrics)
        checks = [_c(n, False, f"unknown metric '{metric}'; known metrics: {names}") for n in CHECK_NAMES]
        return VerifyResult(checks)
    m = rules.metrics[metric]
    checks: list[dict] = []
    skip = lambda name: _c(name, False, "skipped: an earlier check failed")  # noqa: E731

    # 1. parses, single read-only SELECT
    stmt = None
    try:
        stmts = [s for s in sqlglot.parse(sql, dialect=D) if s is not None]
        if len(stmts) != 1:
            checks.append(_c("parses", False, f"expected exactly one statement, found {len(stmts)}"))
        elif isinstance(stmts[0], exp.Union):
            checks.append(_c("parses", False, "UNION/INTERSECT/EXCEPT is not allowed; use a single plain SELECT"))
        elif isinstance(stmts[0], exp.Select) and (
                len(list(stmts[0].find_all(exp.Select))) > 1 or stmts[0].find(exp.With) or stmts[0].find(exp.Union)):
            checks.append(_c("parses", False, "nested SELECT (subquery, CTE, EXISTS, scalar subquery) or UNION is not allowed"))
        elif not isinstance(stmts[0], exp.Select):
            checks.append(_c("parses", False, f"only a read-only SELECT is allowed, got {type(stmts[0]).__name__.upper()}"))
        else:
            stmt = stmts[0]
            checks.append(_c("parses", True, "one read-only SELECT statement"))
    except SqlglotError as e:
        checks.append(_c("parses", False, f"SQL does not parse as DuckDB: {str(e)[:200]}"))
    if stmt is None:
        return VerifyResult(checks + [skip(n) for n in CHECK_NAMES[1:]])

    # 2. allowed tables / columns / forbidden tables
    norm, errors, real = analyze(stmt, rules)
    for t in sorted(real & {x.lower() for x in m.get("forbidden_tables", [])}):
        errors.append(f"table '{t}' is forbidden for metric '{metric}' (joining it double counts)")
    checks.append(_c("allowed_tables_columns", not errors,
                     "; ".join(errors) if errors else f"tables used: {', '.join(sorted(real))}"))
    if errors:
        return _finish_after_schema_failure(checks, norm, rules, metric, m)

    return _remaining(db, rules, stmt, norm, metric, m, checks)


def _finish_after_schema_failure(checks, norm, rules, metric, m) -> VerifyResult:
    """Schema failed: still report expression/predicate/group checks where they can be evaluated
    (useful feedback), but never execute."""
    checks += _structure_checks(norm, rules, metric, m)
    checks += [_c("invariants_hold", False, "skipped: an earlier check failed"),
               _c("executes", False, "skipped: an earlier check failed")]
    return VerifyResult(checks)


def _col_key(c: exp.Expression):
    return (c.table.lower(), c.name.lower()) if isinstance(c, exp.Column) else None


def _is_lit(e) -> bool:
    return isinstance(e, (exp.Literal, exp.Boolean))


def _is_date_lit(e) -> bool:
    if isinstance(e, exp.Cast):
        return isinstance(e.this, exp.Literal) and e.this.is_string and e.to.this == exp.DataType.Type.DATE
    return isinstance(e, exp.Literal) and e.is_string


def _explainable(c: exp.Expression, dim_cols: set, date_column: str) -> bool:
    """(b) dimension column vs literal(s); (c) date column range bound vs date literal."""
    if isinstance(c, (exp.EQ, exp.NEQ)):
        return _col_key(c.left) in dim_cols and _is_lit(c.right)
    if isinstance(c, exp.In):
        return (_col_key(c.this) in dim_cols and not c.args.get("query") and not c.args.get("unnest")
                and bool(c.expressions) and all(_is_lit(x) for x in c.expressions))
    if isinstance(c, (exp.GT, exp.GTE, exp.LT, exp.LTE)):
        return _col_key(c.left) == tuple(date_column.lower().split(".")) and _is_date_lit(c.right)
    return False


def _aggregates(norm: exp.Select):
    return [(i, p) for i, p in enumerate(norm.expressions) if p.find(exp.AggFunc)]


def _structure_checks(norm: exp.Select, rules: Rules, metric: str, m: dict) -> list[dict]:
    out = []
    # 3. aggregate expression equals canonical
    canonical = canon(_canonical_metric(rules, metric).expressions[0])
    aggs = _aggregates(norm)
    if len(aggs) != 1:
        out.append(_c("metric_expression_matches", False, f"expected exactly one aggregate in SELECT, found {len(aggs)}"))
    else:
        got = canon(aggs[0][1])
        if got == canonical:
            out.append(_c("metric_expression_matches", True, "aggregate equals the canonical definition"))
        else:
            out.append(_c("metric_expression_matches", False,
                          f"expression mismatch: expected `{canonical}` but query computes `{got}`"))
    # 4. required predicates
    where = norm.args.get("where")
    have = {canon(c) for c in conjuncts(where.this)} if where else set()
    missing = []
    for p in m["required_predicates"]:
        if canon(sqlglot.parse_one(p, dialect=D)) not in have:
            missing.append(p)
    required_canon = {canon(sqlglot.parse_one(p, dialect=D)) for p in m["required_predicates"]}
    dim_cols = {(d["table"].lower(), d["column"].lower()) for d in rules.dimensions.values() if d["kind"] != "time"}
    unexplained = [c.sql(dialect=D) for c in (conjuncts(where.this) if where else [])
                   if canon(c) not in required_canon and not _explainable(c, dim_cols, m["date_column"])]
    detail = []
    if missing:
        detail.append("missing required predicate(s) in WHERE: " + "; ".join(missing))
    if unexplained:
        detail.append("unexplained WHERE predicate(s) the restatement cannot describe: " + "; ".join(f"`{u}`" for u in unexplained))
    out.append(_c("required_predicates_present", not detail,
                  "; ".join(detail) if detail else "all required predicates present and no unexplained predicates"))
    # 5. group by consistent
    known = {canon(sqlglot.parse_one(dimension_expr(rules, d, m["date_column"]), dialect=D)) for d in rules.dimensions.values()}
    projections = list(norm.expressions)
    agg_idx = {i for i, _ in aggs}
    group = norm.args.get("group")
    gexprs = []
    if group:
        for g in group.expressions:
            if isinstance(g, exp.Literal) and g.is_int and 1 <= int(g.name) <= len(projections):
                gexprs.append(projections[int(g.name) - 1])
            elif isinstance(g, exp.Column) and not g.table and any(
                    isinstance(p, exp.Alias) and p.alias.lower() == g.name.lower() for p in projections):
                gexprs.append(next(p for p in projections if isinstance(p, exp.Alias) and p.alias.lower() == g.name.lower()))
            else:
                gexprs.append(g)
    gset = {canon(g) for g in gexprs}
    problems = []
    for i, p in enumerate(projections):
        if i in agg_idx:
            continue
        c = canon(p)
        if c not in gset:
            problems.append(f"select column `{c}` is not in GROUP BY")
        if c not in known:
            problems.append(f"select column `{c}` is not a known dimension expression")
    for c in sorted(gset):
        if c not in known:
            problems.append(f"GROUP BY `{c}` is not a known dimension expression")
    out.append(_c("group_by_consistent", not problems,
                  "; ".join(problems) if problems else "all non-aggregate columns are grouped known dimensions"))
    return out


def _remaining(db: Database, rules: Rules, stmt: exp.Select, norm: exp.Select, metric: str, m: dict, checks: list) -> VerifyResult:
    checks += _structure_checks(norm, rules, metric, m)
    if not all(c["passed"] for c in checks):
        checks += [_c("invariants_hold", False, "skipped: an earlier check failed"),
                   _c("executes", False, "skipped: an earlier check failed")]
        return VerifyResult(checks)
    agg_i = _aggregates(norm)[0][0]
    # 6. invariants, using the candidate's total over all result rows
    try:
        _, allrows = db.query(stmt.sql(dialect=D), limit=100000)
        total = sum((r[agg_i] or 0) for r in allrows)
        ok, detail = check_invariants(db, rules, metric, total)
    except Exception as e:  # noqa: BLE001
        ok, detail = False, f"could not compute query total: {e}"
    checks.append(_c("invariants_hold", ok, detail))
    # 7. executes with LIMIT 1000 in the read-only connection under 5 s
    cols, rows = [], []
    try:
        limited = stmt.copy()
        lim = limited.args.get("limit")
        if lim is None or not lim.expression.is_int or int(lim.expression.name) > 1000:
            limited = limited.limit(1000)
        cols, rows = db.query(limited.sql(dialect=D), limit=1000, timeout=5.0)
        checks.append(_c("executes", True, f"ran read-only in under 5s, {len(rows)} row(s)"))
    except Exception as e:  # noqa: BLE001
        checks.append(_c("executes", False, f"execution failed or timed out: {str(e)[:200]}"))
        cols, rows = [], []
    res = VerifyResult(checks, cols, rows)
    if not res.passed:
        res.columns, res.rows = [], []
    return res
