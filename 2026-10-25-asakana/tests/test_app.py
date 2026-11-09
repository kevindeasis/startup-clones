import datetime as dt
import json
from types import SimpleNamespace
from unittest import mock

from sqlmodel import Session, select

from app.db import engine

from app import llm, pipeline
from app.db import SAMPLES_DIR
from app.llm_mock import mock_extract
from app.matching import match_line, normalize
from app.models import (Customer, CustomerAlias, DraftLine, DraftOrder, ErpOrder, ExtractedOrder,
                        InboundMessage, PipelineContext, Product)

TODAY = dt.date(2026, 10, 25)  # a Sunday


def _ctx():
    return PipelineContext(today=TODAY)


def _products(session):
    return session.exec(select(Product)).all()


def _intake(client, text=None, customer="Blue Fin Bistro", session=None, channel="sms", **extra):
    cid = ""
    if customer:
        with Session(engine) as s:
            cid = str(s.exec(select(Customer).where(Customer.name == customer)).one().id)
    r = client.post("/intake", data={"body_text": text, "channel": channel, "customer_id": cid, **extra},
                    follow_redirects=False)
    assert r.status_code == 303, r.text
    return int(r.headers["location"].rsplit("/", 1)[1])


def test_mock_extraction_schema():
    text = (SAMPLES_DIR / "sms_bluefin.txt").read_text()
    out = mock_extract(text, _ctx())
    ExtractedOrder.model_validate(out.model_dump())
    qty_lines = [l for l in out.lines if l.qty]
    assert [(l.qty, l.unit) for l in qty_lines] == [(2, "cs"), (10, "lb")]
    assert out.repeat_reference and "last friday" in out.repeat_reference.lower()
    assert out.delivery_date == "2026-10-30"  # next Friday


def test_mock_spanish_trailing_qty_and_image():
    out = mock_extract("Necesito 2 cajas de camarón y hamachi x3", _ctx())
    assert out.lines[0].unit == "cs" and "camar" in out.lines[0].product_text
    assert out.lines[1].qty == 3
    img = mock_extract("", _ctx(), has_image=True)
    assert len(img.lines) == 3 and "ANTHROPIC_API_KEY" in img.questions[0]


def test_match_exact_customer_alias(session):
    sku, conf, cands = match_line("Hama", {normalize("hama"): "HAMACHI-LOIN"}, _products(session))
    assert (sku, conf) == ("HAMACHI-LOIN", 1.0) and cands[0]["sku"] == "HAMACHI-LOIN"


def test_match_fuzzy_salmon_filet(session):
    sku, conf, cands = match_line("salmon filet", {}, _products(session))
    assert sku == "SALMON-FIL-ATL" and conf >= 0.8 and len(cands) == 3


def test_match_spanish_alias(session):
    sku, conf, _ = match_line("camaron", {}, _products(session))
    assert sku.startswith("SHRIMP") and conf >= 0.9


def test_routing_needs_review_when_line_below_threshold(client, session):
    draft_id = _intake(client, "2 cs hama\n5 lb zzzqx widget")
    d = session.get(DraftOrder, draft_id)
    assert d.status == "needs_review"
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft_id)).all()
    assert any(l.confidence < 0.9 and l.flag for l in lines)


def test_routing_auto_approved_when_all_confident(client, session):
    draft_id = _intake(client, "2 cs hama\n10 lb salmon fillet")
    d = session.get(DraftOrder, draft_id)
    assert d.status == "auto_approved"
    html = client.get(f"/orders/{draft_id}").text
    assert "auto approved" in html


def test_intake_sms_sample_has_history_line(client, session):
    text = (SAMPLES_DIR / "sms_bluefin.txt").read_text()
    draft_id = _intake(client, text)
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == draft_id)).all()
    assert len(lines) >= 3
    hist = [l for l in lines if l.source == "history"]
    assert hist and hist[0].sku == "OYSTER-KUM" and hist[0].qty == 3
    assert any(l.sku == "HAMACHI-LOIN" and l.confidence == 1.0 for l in lines)
    assert session.get(DraftOrder, draft_id).delivery_date == dt.date(2026, 10, 30)


def test_approve_creates_erp_order_and_csv(client, session):
    draft_id = _intake(client, "2 cs hama\n10 lb salmon fillet")
    r = client.post(f"/orders/{draft_id}/approve", follow_redirects=False)
    assert r.status_code == 303
    assert session.get(DraftOrder, draft_id).status == "pushed"
    erp = session.exec(select(ErpOrder).where(ErpOrder.draft_id == draft_id)).one()
    csv_text = client.get("/erp/orders.csv").text
    assert erp.erp_number in csv_text and "HAMACHI-LOIN" in csv_text
    assert any(o["erp_number"] == erp.erp_number for o in client.get("/erp/orders").json())
    summ = client.get("/summaries").text
    assert f"Entered order #{erp.erp_number.split('-')[1]} for Blue Fin Bistro" in summ
    assert client.get(f"/api/orders/{draft_id}").json()["summary"]


def test_approve_blocked_with_unresolved_line(client, session):
    draft_id = _intake(client, "2 cs hama\n5 lb zzzqx widget")
    with Session(engine) as s:  # simulate a line the matcher could not resolve
        bad = s.exec(select(DraftLine).where(DraftLine.draft_id == draft_id)).all()[1]
        bad.sku, bad.confidence = None, 0.0
        s.add(bad); s.commit()
    r = client.post(f"/orders/{draft_id}/approve")
    assert r.status_code == 400 and "Resolve all lines" in r.text
    assert session.get(DraftOrder, draft_id).status == "needs_review"
    assert not session.exec(select(ErpOrder).where(ErpOrder.draft_id == draft_id)).all()


def test_learning_loop_alias_created_and_reused(client, session):
    draft_id = _intake(client, "3 lb white fish special")
    line = session.exec(select(DraftLine).where(DraftLine.draft_id == draft_id)).one()
    assert line.confidence < 1.0
    r = client.post(f"/orders/{draft_id}/lines/{line.id}",
                    data={"sku": "COD-LOIN", "qty": "3", "unit": "lb"}, headers={"HX-Request": "true"})
    assert r.status_code == 200 and "Confirmed by reviewer" in r.text
    with Session(engine) as s:
        al = s.exec(select(CustomerAlias).where(CustomerAlias.raw_text_normalized == "white fish special")).one()
        assert al.sku == "COD-LOIN"
    d2 = _intake(client, "3 lb white fish special")
    with Session(engine) as s:
        l2 = s.exec(select(DraftLine).where(DraftLine.draft_id == d2)).one()
        assert l2.sku == "COD-LOIN" and l2.confidence == 1.0
    # alias deletion
    cid = al.customer_id
    assert client.post(f"/customers/{cid}/aliases/{al.id}/delete", follow_redirects=False).status_code == 303
    assert "white fish special" not in client.get(f"/customers/{cid}").text


def test_infer_customer_from_eml_upload(client, session):
    data = (SAMPLES_DIR / "email_elpuerto.eml").read_bytes()
    r = client.post("/intake", data={"channel": "email", "customer_id": "", "body_text": ""},
                    files={"file": ("email_elpuerto.eml", data, "message/rfc822")}, follow_redirects=False)
    assert r.status_code == 303
    d = session.get(DraftOrder, int(r.headers["location"].rsplit("/", 1)[1]))
    cust = session.get(Customer, d.customer_id)
    assert cust.name == "Mariscos El Puerto"
    lines = session.exec(select(DraftLine).where(DraftLine.draft_id == d.id)).all()
    assert len(lines) == 4 and any(l.sku == "SHRIMP-2125-PD" for l in lines)


def test_pdf_and_photo_upload(client, session):
    pdf = (SAMPLES_DIR / "pdf_order_sheet.pdf").read_bytes()
    r = client.post("/intake", data={"channel": "pdf", "customer_id": ""}, follow_redirects=False,
                    files={"file": ("pdf_order_sheet.pdf", pdf, "application/pdf")})
    d = session.get(DraftOrder, int(r.headers["location"].rsplit("/", 1)[1]))
    assert session.get(Customer, d.customer_id).name == "Sakura Omakase"
    assert len(session.exec(select(DraftLine).where(DraftLine.draft_id == d.id)).all()) >= 4
    png = (SAMPLES_DIR / "photo_note.png").read_bytes()
    r = client.post("/intake", data={"channel": "photo", "customer_id": ""}, follow_redirects=False,
                    files={"file": ("photo_note.png", png, "image/png")})
    assert r.status_code == 303
    page = client.get(r.headers["location"]).text
    assert "Mock mode: image reading requires ANTHROPIC_API_KEY" in page


def test_pages_ok(client):
    for path in ["/", "/intake", "/intake?sample=sms_bluefin.txt", "/catalog", "/customers",
                 "/customers/1", "/summaries", "/erp/orders", "/erp/orders.csv"]:
        assert client.get(path).status_code == 200, path


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "llm_provider": "mock"}


def test_anthropic_provider_path_with_mocked_sdk(monkeypatch, session):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    payload = {"customer_name_hint": "Blue Fin", "delivery_date": "2026-10-30", "language": "en",
               "lines": [{"raw_text": "2 cs hama", "qty": 2, "unit": "cs", "product_text": "hama"}],
               "questions": []}
    block = SimpleNamespace(type="tool_use", id="tu_1", name="submit_order", input=payload)
    create = mock.Mock(return_value=SimpleNamespace(content=[block]))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    with mock.patch("anthropic.Anthropic", return_value=fake_client):
        msg = InboundMessage(channel="sms", body_text="2 cs hama pls")
        out = llm.extract_order(msg, _ctx())
    assert out.lines[0].product_text == "hama" and out.delivery_date == "2026-10-30"
    kw = create.call_args.kwargs
    assert kw["tool_choice"] == {"type": "tool", "name": "submit_order"}
    assert kw["tools"][0]["name"] == "submit_order" and kw["max_tokens"] == 2048
    assert "$ref" not in json.dumps(kw["tools"][0]["input_schema"])
    assert llm.provider_name() == "anthropic"


def test_anthropic_retries_once_on_validation_error(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    bad = SimpleNamespace(type="tool_use", id="a", name="submit_order", input={"lines": "nope"})
    good = SimpleNamespace(type="tool_use", id="b", name="submit_order",
                           input={"lines": [{"raw_text": "x", "product_text": "x", "qty": 1}]})
    create = mock.Mock(side_effect=[SimpleNamespace(content=[bad]), SimpleNamespace(content=[good])])
    with mock.patch("anthropic.Anthropic", return_value=SimpleNamespace(messages=SimpleNamespace(create=create))):
        out = llm.extract_order(InboundMessage(channel="sms", body_text="x"), _ctx())
    assert create.call_count == 2 and out.lines[0].qty == 1


def test_pipeline_falls_back_to_mock_when_llm_errors(monkeypatch, session):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    with mock.patch("anthropic.Anthropic", side_effect=RuntimeError("boom")):
        msg = InboundMessage(channel="sms", body_text="2 cs hama")
        session.add(msg); session.commit()
        c = session.exec(select(Customer)).first()
        d = pipeline.process_message(session, msg, c.id, today=TODAY)
    assert d.status == "needs_review" and any("LLM call failed" in q for q in d.questions())
