from pathlib import Path

import pymupdf

from app import forensics
from .conftest import png_bytes
from .test_api import make_pdf

SAMPLES = Path(__file__).resolve().parent.parent / "sample_data"


def flags_of(fl):
    return {f["flag"] for f in fl}


def test_two_eof_markers_flagged(tmp_path):
    p = tmp_path / "a.pdf"
    p.write_bytes(make_pdf("Invoice total $5"))
    doc = pymupdf.open(str(p))
    doc.set_metadata({**doc.metadata, "producer": "Smallpdf"})
    doc.saveIncr()
    data = p.read_bytes()
    assert data.count(b"%%EOF") == 2
    fl = forensics.analyze(data, "application/pdf", "invoice", "2026-03-14")
    assert "incremental_update" in flags_of(fl)
    assert "editor_software" in flags_of(fl)


def test_clean_pdf_has_no_incremental_flag():
    fl = forensics.analyze(make_pdf("hello"), "application/pdf", "fnol", "2026-03-14")
    assert "incremental_update" not in flags_of(fl)


def test_sample_invoice_has_two_eof():
    data = (SAMPLES / "invoice.pdf").read_bytes()
    assert data.count(b"%%EOF") == 2
    assert "incremental_update" in flags_of(forensics.analyze(data, "application/pdf", "invoice", "2026-03-14"))


def test_image_without_exif():
    fl = forensics.analyze(png_bytes(), "image/png", "photo", "2026-03-14")
    assert flags_of(fl) == {"no_exif"} and fl[0]["severity"] == "info"


def test_image_exif_predates_loss_and_editor():
    fl = forensics.analyze(png_bytes(exif=True), "image/jpeg", "photo", "2026-03-14")
    assert {"software_tag", "photo_predates_loss"} <= flags_of(fl)
