"""Deterministic treatment/holdout assignment."""
import hashlib


def bucket(conversation_id: str, correction_id: str) -> int:
    h = hashlib.sha256(f"{conversation_id}:{correction_id}".encode()).hexdigest()
    return int(h[:12], 16) % 100


def assign(conversation_id: str, correction_id: str, holdout_pct: int) -> str:
    """Return 'holdout' for roughly holdout_pct% of conversations, else 'treatment'."""
    return "holdout" if bucket(conversation_id, correction_id) < holdout_pct else "treatment"
