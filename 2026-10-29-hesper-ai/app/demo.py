"""Demo claim loader: creates a claim and uploads the bundled sample documents."""
from __future__ import annotations

from pathlib import Path

from . import db, extract

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"
DEMO_DOCS = [("policy.txt", "policy"), ("fnol.pdf", "fnol"), ("statement.txt", "statement"), ("invoice.pdf", "invoice")]


def load_demo_claim() -> dict:
    claim = db.create_claim(
        "CLM-2026-0457", "homeowners", "Dana Whitfield", "2026-03-14",
        "Water damage to finished basement after heavy rain; water seeping through the foundation floor and walls.")
    for fname, dtype in DEMO_DOCS:
        extract.ingest_document(claim, fname, dtype, (SAMPLE_DIR / fname).read_bytes())
    return claim
