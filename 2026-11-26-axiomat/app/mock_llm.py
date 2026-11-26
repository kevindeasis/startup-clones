"""Deterministic keyword interpreter used when no API key is present (or PROVEN_MOCK=1)."""
from __future__ import annotations

import re
from datetime import date

from .models import Filter, Interpretation, TimeRange

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]


def _metric(q: str) -> str | None:
    if re.search(r"refund", q):
        return "refunds"
    if re.search(r"revenue|sales|income|collected", q):
        return "revenue"
    if re.search(r"\bmrr\b|recurring", q):
        return "mrr"
    if re.search(r"subscription", q):
        return "active_subscriptions"
    if re.search(r"churn", q):
        return "churned_customers"
    if re.search(r"trial account|\btrials?\b", q) and "customer" not in q:
        return "trial_accounts"
    if re.search(r"customer|client|account", q):
        return "customers"
    return None


def _time_range(q: str) -> TimeRange | None:
    year_m = re.search(r"\b(2025|2026)\b", q)
    year = int(year_m.group(1)) if year_m else 2026
    qm = re.search(r"\bq([1-4])\b", q)
    if qm:
        n = int(qm.group(1))
        start = date(year, 3 * (n - 1) + 1, 1)
        end = date(year + 1, 1, 1) if n == 4 else date(year, 3 * n + 1, 1)
        return TimeRange(start=start, end=end)
    for i, name in enumerate(MONTHS, start=1):
        if re.search(rf"\b(in|during|for)\s+{name}\b", q):
            end = date(year + 1, 1, 1) if i == 12 else date(year, i + 1, 1)
            return TimeRange(start=date(year, i, 1), end=end)
    if year_m or "this year" in q:
        return TimeRange(start=date(year, 1, 1), end=date(year + 1, 1, 1))
    return None


def interpret(question: str, failures: list[str] | None = None) -> Interpretation:
    q = question.lower()
    metric = _metric(q)
    if metric is None:
        return Interpretation(cannot_answer="No metric in the business rules matches this question "
                                            "(known: revenue, customers, active_subscriptions, mrr, trial_accounts, churned_customers, refunds).")
    group_by = []
    if re.search(r"by month|monthly|per month|each month|month by month", q):
        group_by.append("month")
    if re.search(r"by plan|per plan|each plan", q):
        group_by.append("plan")
    if re.search(r"by country|per country|each country", q):
        group_by.append("country")
    if re.search(r"by (account )?status", q):
        group_by.append("account_status")
    filters: list[Filter] = []
    # question is matched case-sensitively for country codes so "us" in "tell us" is ignored
    country = None
    if re.search(r"\bUS\b|\bUSA\b|united states", question) or "united states" in q:
        country = "US"
    elif re.search(r"\bCA\b|canada", question) or "canada" in q:
        country = "CA"
    elif re.search(r"\bUK\b|united kingdom", question) or "united kingdom" in q:
        country = "UK"
    elif re.search(r"\bDE\b|germany", question) or "germany" in q:
        country = "DE"
    if country and "by country" not in q:
        filters.append(Filter(dimension="country", op="=", value=country))
    pm = re.search(r"\b(starter|growth|enterprise)\b(?: plan)?", q)
    if pm and "by plan" not in q:
        filters.append(Filter(dimension="plan", op="=", value=pm.group(1)))
    if "including trials" in q and not failures:
        # Deliberately naive first attempt: override the business rule and count trials.
        filters.append(Filter(dimension="is_trial", op="=", value="true"))
    return Interpretation(metric=metric, group_by=group_by, filters=filters, time_range=_time_range(q))
