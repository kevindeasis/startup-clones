import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import pipeline
from app.extract import chunk_pages, extract_pages
from app.llm import AnthropicProvider, LLMConfigError, LLMError, get_provider, parse_json_loose, reset_provider
from app.mock_llm import MockProvider
from app.models import Chunk, Document

SAMPLE = Path(__file__).resolve().parent.parent / "sample_docs"


def load_cards():
    prov, cards, singles = MockProvider(), [], []
    for i, (name, kind) in enumerate(
        [("01_prime_contract.pdf", "contract"), ("02_specifications_div03.pdf", "spec"), ("03_drawing_notes_S-001.pdf", "drawing")], 1
    ):
        doc = Document(id=i, project_id=1, filename=name, kind=kind)
        chunks = [Chunk(document_id=i, page=p, idx=ix, text=t) for p, ix, t in chunk_pages(extract_pages((SAMPLE / name).read_bytes(), name))]
        c, s = pipeline.stage1(prov, doc, chunks)
        cards += c
        singles += s
    return prov, cards, singles


def test_stage1_finds_concrete_strength():
    _, cards, _ = load_cards()
    strength = [c for c in cards if c["topic"] == "concrete_compressive_strength"]
    assert {c["value"] for c in strength} == {"4,000 psi", "3,500 psi", "3,000 psi"}
    topics = {c["topic"] for c in cards}
    assert {"substantial_completion_days", "notice_period_days", "liquidated_damages_rate",
            "retainage_percent", "warranty_period"} <= topics


def test_stage1_single_doc_risk_pay_when_paid():
    _, _, singles = load_cards()
    assert any("pay-when-paid" in s["title"].lower() for s in singles)


def test_stage2_emits_four_contradictions():
    prov, cards, _ = load_cards()
    risks = pipeline.stage2(prov, cards)
    titles = " ".join(r["title"] for r in risks).lower()
    assert len(risks) >= 4
    for k in ("concrete compressive strength", "substantial completion", "warranty", "notice period"):
        assert k in titles
    assert all(len({c["document"] for c in r["citations"]}) >= 2 for r in risks)


def test_window_chunks_respects_limit():
    chunks = [Chunk(document_id=1, page=1, idx=i, text="x" * 5000) for i in range(5)]
    wins = pipeline.window_chunks(chunks, 12000)
    assert [len(w) for w in wins] == [2, 2, 1]


def test_parse_json_loose():
    assert parse_json_loose('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_loose('Sure! {"a": [1, 2]} done') == {"a": [1, 2]}


def _fake_client(replies):
    calls = []

    def create(**kw):
        calls.append(kw)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=replies.pop(0))])

    return SimpleNamespace(messages=SimpleNamespace(create=create)), calls


def test_anthropic_provider_json_and_retry():
    client, calls = _fake_client(["not json at all", '```json\n{"ok": true}\n```'])
    p = AnthropicProvider("k", "claude-sonnet-5-5", client=client)
    assert p.complete_json("sys", "user", '{"ok":bool}') == {"ok": True}
    assert len(calls) == 2  # retried once
    assert calls[0]["max_tokens"] == 4096 and calls[0]["temperature"] == 0
    assert calls[0]["model"] == "claude-sonnet-5-5"
    client2, _ = _fake_client(["bad", "still bad"])
    with pytest.raises(LLMError):
        AnthropicProvider("k", "m", client=client2).complete_json("s", "u")


def test_anthropic_provider_text_and_error():
    client, calls = _fake_client(["Dear Sir,"])
    assert AnthropicProvider("k", "m", client=client).complete_text("s", "u") == "Dear Sir,"

    def boom(**kw):
        raise RuntimeError("down")

    bad = SimpleNamespace(messages=SimpleNamespace(create=boom))
    with pytest.raises(LLMError):
        AnthropicProvider("k", "m", client=bad).complete_text("s", "u")


def test_anthropic_provider_monkeypatched_sdk(monkeypatch):
    import anthropic

    client, _ = _fake_client([json.dumps({"requirements": [], "single_doc_risks": []})])
    monkeypatch.setattr(anthropic, "Anthropic", lambda api_key=None: client)
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    reset_provider()
    p = get_provider()
    assert p.name == "anthropic"
    assert pipeline.stage1(p, Document(id=1, project_id=1, filename="a.pdf", kind="spec"),
                           [Chunk(document_id=1, page=1, idx=0, text="x")]) == ([], [])
    reset_provider()


def test_anthropic_without_key_is_config_error(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    reset_provider()
    with pytest.raises(LLMConfigError):
        get_provider()
    reset_provider()
