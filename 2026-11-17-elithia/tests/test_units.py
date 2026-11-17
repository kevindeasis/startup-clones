import json

import pymupdf
import pytest

from app import pdfutil, pipeline
from app.dates import find_dates, normalize_date
from app.llm import (AnthropicLLM, MockLLM, first_sentence, mock_classify_text, mock_conflicts, parse_json_defensive,
                     validate_events)


def make_pdf(path, texts):
    doc = pymupdf.open()
    for t in texts:
        pg = doc.new_page()
        if t:
            pg.insert_text((72, 72), t, fontsize=11)
    doc.save(str(path))
    doc.close()


def test_blank_detection(tmp_path):
    p = tmp_path / "b.pdf"
    make_pdf(p, [None, "Progress note: patient seen today and doing well. Plan to continue medications."])
    with pymupdf.open(str(p)) as d:
        assert pdfutil.is_blank(d[0], pdfutil.extract_text(d[0])) is True
        assert pdfutil.is_blank(d[1], pdfutil.extract_text(d[1])) is False


def test_exact_duplicate_detection():
    t = "Discharge summary. " * 30
    pages = [dict(id=1, text=t, is_blank=0), dict(id=2, text="Totally different content here. " * 20, is_blank=0),
             dict(id=3, text=t.upper(), is_blank=0)]
    d = pipeline.find_duplicates(pages)
    assert d == {3: (1, "exact duplicate")}


def test_near_duplicate_detection_and_no_false_positive():
    base = "Nursing note 16 Mar 2024 patient returned to ward alert and oriented, dressing clean and dry. " * 8
    rescan = base.replace("clean and dry", "clean and dry.", 1).replace("oriented", "orlented", 1)
    other = "Operative report right hip hemiarthroplasty posterolateral approach cemented stem. " * 9
    d = pipeline.find_duplicates([dict(id=1, text=base, is_blank=0), dict(id=2, text=other, is_blank=0),
                                  dict(id=3, text=rescan, is_blank=0)])
    assert list(d) == [3] and d[3][0] == 1 and "near-duplicate" in d[3][1]


@pytest.mark.parametrize("raw", ["03/14/2024", "March 14, 2024", "2024-03-14", "14 Mar 2024", "14 March 2024", "Mar 14, 2024"])
def test_date_normalisation_formats(raw):
    assert normalize_date(raw) == "2024-03-14"
    assert find_dates(f"seen on {raw} at clinic")[0][2] == "2024-03-14"


def test_invalid_date():
    assert normalize_date("13/45/2024") is None and normalize_date("") is None


def test_bates_assignment_order():
    pg = lambda f, i, d: dict(file_id=f, page_index=i, service_date=d, doc_type="x", facility=None, provider=None,
                              page_role="first", confidence=1)
    docs = pipeline.order_documents([[pg(1, 0, "2024-03-20")], [pg(1, 1, None)], [pg(2, 0, "2024-03-10"), pg(2, 1, "2024-03-10")]])
    docs = pipeline.assign_bates(docs)
    assert [d["service_date"] for d in docs] == ["2024-03-10", "2024-03-20", None]
    assert docs[2]["undated"] == 1
    allb = [p["bates"] for d in docs for p in d["pages"]]
    assert allb == [f"CHR-{i:06d}" for i in range(1, 5)]
    assert docs[0]["bates_start"] == "CHR-000001" and docs[0]["bates_end"] == "CHR-000002"


def test_event_citation_validation():
    ok = dict(date="14 Mar 2024", summary="Fall at home.", source_pages=["CHR-000001"], category="visit", significance="high")
    unknown = dict(ok, source_pages=["CHR-000099"])
    mixed = dict(ok, source_pages=["CHR-000001", "CHR-000099"])
    none = dict(ok, source_pages=[])
    res = validate_events([ok, unknown, mixed, none], ["CHR-000001", "CHR-000002"])
    assert len(res) == 1 and res[0].date == "2024-03-14"


def test_conflict_heuristic():
    evs = [dict(id=1, summary="Right hip hemiarthroplasty was performed on 2024-03-16 under spinal anaesthesia.", quote=""),
           dict(id=2, summary="Letter.", quote="She underwent right hip hemiarthroplasty on 17 March 2024 and is well"),
           dict(id=3, summary="Allergies: NKDA per patient.", quote="Allergies: NKDA per patient."),
           dict(id=4, summary="Allergies: penicillin (anaphylaxis).", quote=""),
           dict(id=5, summary="Walking with frame.", quote="")]
    c = mock_conflicts(evs)
    assert len(c) == 2
    assert {1, 2} <= set(c[0]["event_ids"]) and {3, 4} <= set(c[1]["event_ids"])
    assert mock_conflicts([evs[0], evs[4]]) == []


def test_mock_classify_and_first_sentence():
    txt = "St. Mary's\n\nOPERATIVE REPORT\n\nDate of service: 2024-03-16 | Provider: Dr. R. Okafor\n\nPatient: X | MRN 1 | Page 1 of 3 | St. Mary's Hospital"
    c = mock_classify_text("k", txt)
    assert c.doc_type == "operative report" and c.service_date == "2024-03-16" and c.page_role == "first"
    assert c.facility == "St. Mary's Hospital"
    assert first_sentence("Seen by Dr. R. Okafor today. Next sentence.") == "Seen by Dr. R. Okafor today."


def test_parse_json_defensive():
    assert parse_json_defensive('```json\n[{"a": 1}]\n```') == [{"a": 1}]
    assert parse_json_defensive('Here you go: {"conflicts": []} thanks') == {"conflicts": []}
    with pytest.raises(ValueError):
        parse_json_defensive("no json at all")


class _Resp:
    def __init__(self, text):
        self.content = [type("B", (), {"type": "text", "text": text})()]


class _Stub:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        self.messages = self

    def create(self, **kw):
        self.calls.append(kw)
        return _Resp(self.replies.pop(0))


def test_live_client_retries_on_invalid_json_and_validates():
    good = json.dumps([{"date": "2024-03-14", "summary": "Fall.", "source_pages": ["CHR-000001"], "category": "visit"},
                       {"date": "2024-03-14", "summary": "Bad cite.", "source_pages": ["CHR-000042"]}])
    stub = _Stub(["sorry, here you go", "```json\n" + good + "\n```"])
    runs = []
    llm = AnthropicLLM(case_id=1, recorder=runs.append, client=stub)
    evs = llm.extract_events(dict(doc_type="ED", facility="F", service_date="2024-03-14", pages=[dict(bates="CHR-000001", text="x")]))
    assert len(evs) == 1 and len(stub.calls) == 2
    assert stub.calls[0]["model"] == "claude-sonnet-5-5" and stub.calls[0]["max_tokens"] == 4000
    assert runs and runs[0]["purpose"] == "extract_events" and runs[0]["mode"] == "live"


def test_mock_llm_is_deterministic():
    batch = dict(doc_type="operative report", facility="F", service_date="2024-03-16",
                 pages=[dict(bates="CHR-000001", text="2024-03-16 08:05 - Right hip hemiarthroplasty was performed on 2024-03-16. More.")])
    a, b = MockLLM().extract_events(batch), MockLLM().extract_events(batch)
    assert a == b and a[0].time == "08:05" and a[0].source_pages == ["CHR-000001"]
