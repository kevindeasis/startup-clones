from pathlib import Path

import pytest

from app.extract import ExtractionError, chunk_page, chunk_pages, extract_pages, guess_kind

SAMPLE = Path(__file__).resolve().parent.parent / "sample_docs"


def test_extract_pdf_pages():
    pages = extract_pages((SAMPLE / "01_prime_contract.pdf").read_bytes(), "01_prime_contract.pdf")
    assert len(pages) == 2
    assert "180 calendar days" in pages[0]
    assert "pay-when-paid" in pages[1]


def test_chunks_never_cross_pages():
    pages = ["Para one. " * 100 + "\n\n" + "Para two. " * 100, "Second page text.\n\nMore text."]
    chunks = chunk_pages(pages)
    assert {c[0] for c in chunks} == {1, 2}
    assert "Second page" not in "".join(c[2] for c in chunks if c[0] == 1)
    assert all(len(c[2]) <= 1800 for c in chunks)
    assert [c[1] for c in chunks] == list(range(len(chunks)))


def test_chunk_page_splits_long_text():
    text = "\n\n".join(f"Paragraph {i}. " + "word " * 120 for i in range(8))
    chunks = chunk_page(text)
    assert len(chunks) > 1 and all(len(c) <= 1800 for c in chunks)


def test_text_and_unsupported_and_bad_pdf():
    assert extract_pages(b"hello\n\nworld", "a.md") == ["hello\n\nworld"]
    with pytest.raises(ExtractionError):
        extract_pages(b"x", "a.docx")
    with pytest.raises(ExtractionError):
        extract_pages(b"not a pdf", "a.pdf")


def test_guess_kind():
    assert guess_kind("01_prime_contract.pdf") == "contract"
    assert guess_kind("02_specifications_div03.pdf") == "spec"
    assert guess_kind("03_drawing_notes_S-001.pdf") == "drawing"
