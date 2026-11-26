"""Interpretation -> SQL + English restatement. Pure code; no LLM involved."""
from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

from .models import Interpretation
from .rules import Rules

D = "duckdb"


class CompileError(Exception):
    pass


@dataclass
class Compiled:
    sql: str
    restatement: str
    metric: str


def _lit(v: str) -> str:
    return exp.Literal.string(v).sql(dialect=D)


def _pred_columns(pred: str) -> set[tuple[str, str]]:
    return {(c.table.lower(), c.name.lower()) for c in sqlglot.parse_one(pred, dialect=D).find_all(exp.Column)}


def dimension_expr(rules: Rules, dim: dict, date_col: str) -> str:
    if dim["kind"] == "time":
        return dim["sql"].replace("{date_col}", date_col)
    return f"{dim['table']}.{dim['column']}"


def compile_interpretation(rules: Rules, it: Interpretation, allowed_values: dict[str, list] | None = None) -> Compiled:
    if it.metric not in rules.metrics:
        raise CompileError(f"unknown metric '{it.metric}'; known metrics: {', '.join(rules.metrics)}")
    m = rules.metrics[it.metric]
    tables = set(rules.metric_tables(it.metric))
    date_col = m["date_column"]

    def need_dim(name: str) -> dict:
        if name not in rules.dimensions:
            raise CompileError(f"unknown dimension '{name}'; known dimensions: {', '.join(rules.dimensions)}")
        d = rules.dimensions[name]
        if d["kind"] != "time" and d["table"] not in tables:
            raise CompileError(f"dimension '{name}' (table {d['table']}) is not reachable from metric '{it.metric}'")
        return d

    select_items, group_exprs, group_english = [], [], []
    for g in it.group_by:
        d = need_dim(g)
        e = dimension_expr(rules, d, date_col)
        select_items.append(f"{e} AS {d['name']}")
        group_exprs.append(e)
        group_english.append(d["english"])

    preds = list(m["required_predicates"])
    where_english = []
    for f in it.filters:
        d = need_dim(f.dimension)
        if d["kind"] == "time":
            raise CompileError("cannot filter on 'month'; use time_range instead")
        col = (d["table"], d["column"])
        vals = f.value if isinstance(f.value, list) else [f.value]
        if f.op == "in" and not isinstance(f.value, list):
            vals = [f.value]
        if f.op != "in" and isinstance(f.value, list):
            raise CompileError(f"operator '{f.op}' needs a single value for '{f.dimension}'")
        if d["kind"] == "boolean":
            for v in vals:
                if str(v).lower() not in ("true", "false"):
                    raise CompileError(f"'{f.dimension}' must be true or false, got '{v}'")
            lits = [str(v).lower().upper() for v in vals]
            shown = [str(v).lower() for v in vals]
        else:
            if allowed_values and f.dimension in allowed_values:
                ok = [str(x) for x in allowed_values[f.dimension]]
                for v in vals:
                    if v not in ok:
                        raise CompileError(f"value '{v}' is not an allowed value for '{f.dimension}'; allowed: {', '.join(ok)}")
            lits = [_lit(v) for v in vals]
            shown = [_lit(v) for v in vals]
        c = f"{d['table']}.{d['column']}"
        if f.op == "in":
            sql_pred, eng = f"{c} IN ({', '.join(lits)})", f"{d['english']} in ({', '.join(shown)})"
        else:
            sql_op = "=" if f.op == "=" else "<>"
            sql_pred, eng = f"{c} {sql_op} {lits[0]}", f"{d['english']} {f.op} {shown[0]}"
        # A user-supplied filter on the same column as a required predicate OVERRIDES it
        # (this is the naive behaviour the verifier exists to catch).
        preds = [p for p in preds if col not in _pred_columns(p)]
        preds.append(sql_pred)
        where_english.append(eng)

    time_english = None
    if it.time_range:
        tr = it.time_range
        if tr.end <= tr.start:
            raise CompileError("time_range end must be after start (start inclusive, end exclusive)")
        preds.append(f"{date_col} >= CAST({_lit(tr.start.isoformat())} AS DATE)")
        preds.append(f"{date_col} < CAST({_lit(tr.end.isoformat())} AS DATE)")
        time_english = f"{m['date_label']} from {tr.start} up to but not including {tr.end}"

    select_items.append(f"{m['sql']} AS {m['name']}")
    q = sqlglot.select(*select_items, dialect=D).from_(m["base"], dialect=D)
    for j in m.get("joins", []):
        q = q.join(j, dialect=D)
    for p in preds:
        q = q.where(p, dialect=D)
    if group_exprs:
        q = q.group_by(*group_exprs, dialect=D).order_by("1", dialect=D)
    sql = q.sql(dialect=D)

    text = m["english"][0].upper() + m["english"][1:]
    parts = [text]
    if group_english:
        parts.append("grouped by " + ", ".join(group_english))
    if where_english:
        parts.append("where " + " and ".join(where_english))
    if time_english:
        parts.append("with " + time_english)
    restatement = ", ".join(parts) + "."
    return Compiled(sql=sql, restatement=restatement, metric=it.metric)
