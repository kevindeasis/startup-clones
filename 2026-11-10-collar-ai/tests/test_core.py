from datetime import date

from app import ingest, qa, retrieval, targeting


def test_chunking_size_overlap_and_coverage():
    text = " ".join(f"Sentence number {i} is here." for i in range(200))
    chunks = ingest.chunk_text(text)
    assert len(chunks) > 3
    assert all(len(c) <= 800 for c in chunks)
    # overlap: end of a chunk reappears at the start of the next
    assert chunks[0][-40:].strip().split()[-1] in chunks[1]
    assert ingest.chunk_text("short") == ["short"]
    assert ingest.chunk_text("   ") == []


def test_parse_markdown_labels():
    secs = ingest.parse_file("a.md", b"# One\nalpha\n# Two\nbeta")
    assert [s[0] for s in secs] == ["One", "Two"]


def test_bm25_retrieval_ranks_relevant_and_rejects_irrelevant():
    chunks = [{"id": 1, "text": "Revenue grew 18% year over year", "label": "a", "title": "T"},
              {"id": 2, "text": "Supply chain risk from lidar suppliers", "label": "b", "title": "T"},
              {"id": 3, "text": "Cash balance was strong", "label": "c", "title": "T"}]
    assert retrieval.rank_chunks("what was revenue growth", chunks)[0]["id"] == 1
    assert retrieval.rank_chunks("favorite pizza topping", chunks) == []


def test_number_validation():
    assert qa.validate_numbers("Revenue was $412.5 million, up 18.4%.", ["Revenue of $412.5 million grew 18.4%"]) == []
    w = qa.validate_numbers("Revenue was 999 million", ["Revenue of 412.5 million"])
    assert len(w) == 1 and "999" in w[0]
    assert qa.validate_numbers("It was 1,300", ["backlog $1300 million"]) == []


def test_scoring_deterministic():
    inv = {"style": "growth", "aum_musd": 5000, "sectors": "robotics, ai", "holds_us": 1}
    a = targeting.score_investor(inv, "2026-10-01", 2, date(2026, 11, 10))
    b = targeting.score_investor(inv, "2026-10-01", 2, date(2026, 11, 10))
    assert a == b and 0 < a["score"] <= 100
    weak = targeting.score_investor({"style": "value", "aum_musd": 10, "sectors": "utilities", "holds_us": 0}, None, 0, date(2026, 11, 10))
    assert weak["score"] < a["score"]
