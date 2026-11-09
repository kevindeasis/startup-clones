"""Prometheus metrics."""
from prometheus_client import Counter, Histogram

ANSWERS_SCORED = Counter("latent_answers_scored", "Answers scored")
ANSWERS_FLAGGED = Counter("latent_answers_flagged", "Answers flagged", ["failure_type"])
REVIEWS = Counter("latent_reviews", "Reviewer decisions", ["decision"])
JUDGE_LATENCY = Histogram("latent_judge_latency_seconds", "Judge latency in seconds")
