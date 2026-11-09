"""Deterministic document forensics (no LLM)."""
from __future__ import annotations

import io
import re
from datetime import datetime, timedelta, timezone

EDITORS = ["photoshop", "word", "canva", "ilovepdf", "smallpdf", "gimp", "pixlr", "acrobat pro", "sejda"]
SENSITIVE_TYPES = {"invoice", "police_report", "medical"}
IMAGE_EDITORS = ["photoshop", "gimp", "lightroom", "canva", "pixlr", "snapseed", "picsart", "affinity"]


def flag(flag_: str, severity: str, detail: str) -> dict:
    return {"flag": flag_, "severity": severity, "detail": detail}


def parse_pdf_date(s: str | None) -> datetime | None:
    if not s:
        return None
    m = re.match(r"D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?", s.strip())
    if not m:
        return None
    parts = [int(x) if x else d for x, d in zip(m.groups(), (1970, 1, 1, 0, 0, 0))]
    try:
        return datetime(*parts, tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_loose_date(s: str | None) -> datetime | None:
    if not s:
        return None
    m = re.search(r"(\d{4})[-:/](\d{2})[-:/](\d{2})", s)
    if not m:
        return None
    try:
        return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc)
    except ValueError:
        return None


def count_eof(data: bytes) -> int:
    return data.count(b"%%EOF")


def analyze_pdf(data: bytes, doc_type: str) -> list[dict]:
    import pymupdf as fitz  # PyMuPDF

    flags: list[dict] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # corrupt
        return [flag("unreadable_pdf", "medium", f"PDF could not be opened: {e}")]
    meta = doc.metadata or {}
    created, modified = parse_pdf_date(meta.get("creationDate")), parse_pdf_date(meta.get("modDate"))
    if created and modified:
        if modified < created:
            flags.append(flag("modified_before_created", "high", f"Modification date {modified:%Y-%m-%d} precedes creation date {created:%Y-%m-%d}."))
        elif modified - created > timedelta(days=1):
            days = (modified - created).days
            flags.append(flag("modified_after_creation", "medium", f"Document modified {days} day(s) after creation ({created:%Y-%m-%d} -> {modified:%Y-%m-%d})."))
    producer_creator = f"{meta.get('producer', '')} {meta.get('creator', '')}".lower()
    if doc_type in SENSITIVE_TYPES:
        for ed in EDITORS:
            if ed in producer_creator:
                flags.append(flag("editor_software", "medium", f"Document typed '{doc_type}' was produced/edited with '{ed}' (producer='{meta.get('producer', '')}', creator='{meta.get('creator', '')}')."))
                break
    eofs = count_eof(data)
    if eofs > 1:
        flags.append(flag("incremental_update", "high", f"Document was re-saved after creation ({eofs} %%EOF markers = {eofs - 1} incremental update(s))."))
    fonts = set()
    text_len = 0
    for page in doc:
        for f in page.get_fonts():
            fonts.add(f[3])
        text_len += len(page.get_text().strip())
    if doc_type == "invoice" and len(fonts) > 6:
        flags.append(flag("many_fonts", "medium", f"Unusual number of fonts for an invoice ({len(fonts)})."))
    if text_len == 0:
        flags.append(flag("no_text_layer", "info", "No text layer found (scanned image or empty PDF); text could not be extracted."))
    doc.close()
    return flags


def analyze_image(data: bytes, loss_date: str | None) -> list[dict]:
    from PIL import Image

    flags: list[dict] = []
    try:
        img = Image.open(io.BytesIO(data))
        exif = img.getexif()
    except Exception as e:
        return [flag("unreadable_image", "medium", f"Image could not be read: {e}")]
    if not exif or len(exif) == 0:
        return [flag("no_exif", "info", "No EXIF (possibly screenshot or re-encoded).")]
    software = exif.get(0x0131)
    if software:
        sw = str(software)
        sev = "medium" if any(e in sw.lower() for e in IMAGE_EDITORS) else "info"
        flags.append(flag("software_tag", sev, f"EXIF Software tag present: '{sw}'."))
    try:
        sub = exif.get_ifd(0x8769)
    except Exception:
        sub = {}
    taken = parse_loose_date(str(sub.get(0x9003) or exif.get(0x0132) or ""))
    loss = parse_loose_date(loss_date)
    if taken and loss:
        if taken < loss:
            flags.append(flag("photo_predates_loss", "high", f"Photo taken {taken:%Y-%m-%d}, before the reported loss date {loss:%Y-%m-%d}."))
        elif taken - loss > timedelta(days=60):
            flags.append(flag("photo_long_after_loss", "medium", f"Photo taken {taken:%Y-%m-%d}, more than 60 days after loss date {loss:%Y-%m-%d}."))
    elif not taken:
        flags.append(flag("no_capture_date", "info", "EXIF present but no DateTimeOriginal."))
    return flags


def analyze(data: bytes, mime: str, doc_type: str, loss_date: str | None) -> list[dict]:
    if mime == "application/pdf":
        return analyze_pdf(data, doc_type)
    if mime.startswith("image/"):
        return analyze_image(data, loss_date)
    return [flag("text_file", "info", "Plain text file; no file-level forensic signals available.")]
