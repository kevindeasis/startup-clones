"""Text extraction and document ingestion."""
from __future__ import annotations

import re
from pathlib import Path

from . import db, forensics

ALLOWED = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
    ".md": "text/markdown",
}
DOC_TYPES = ["policy", "fnol", "statement", "police_report", "medical", "invoice", "photo", "adjuster_notes", "other"]


class IngestError(ValueError):
    pass


def extract_text(data: bytes, mime: str) -> tuple[str, int]:
    """Return (text, page_count)."""
    if mime == "application/pdf":
        import pymupdf as fitz

        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except Exception as e:
            raise IngestError(f"Invalid PDF: {e}")
        text = "\n".join(p.get_text() for p in doc).strip()
        n = doc.page_count
        doc.close()
        return text, n
    if mime.startswith("image/"):
        return "", 1  # images go straight to the vision model
    return data.decode("utf-8", errors="replace"), 1


def ingest_document(claim: dict, filename: str, doc_type: str, data: bytes) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED:
        raise IngestError(f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED)}")
    if doc_type not in DOC_TYPES:
        raise IngestError(f"Invalid doc_type '{doc_type}'.")
    mime = ALLOWED[ext]
    text, pages = extract_text(data, mime)
    flags = forensics.analyze(data, mime, doc_type, claim.get("loss_date"))
    did = db.new_id()
    for f in flags:
        f["document_id"] = did
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
    folder = db.data_dir() / "uploads" / claim["id"]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{did}_{safe}"
    path.write_bytes(data)
    import json

    db.execute(
        "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (did, claim["id"], Path(filename).name, doc_type, mime, len(data), str(path), text, pages, json.dumps(flags), db.now()),
    )
    return db.get_document(did)
