from app import llm, mock_llm, models as M
from app.pipeline import build_blocks


def test_provider_falls_back_to_mock(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    assert llm.provider_name() == "mock"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert llm.provider_name() == "anthropic"


def test_strip_fences():
    assert llm.strip_fences('```json\n{"a": 1}\n```') == '{"a": 1}'


def test_mock_facts_extracts_dates_and_amounts(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    payload = {"document_id": "d1", "filename": "f.txt", "doc_type": "fnol", "claimant_name": "A", "text": "Date of Loss: 2026-03-14\nEstimated damage: $6,500.00"}
    res, usage = llm.complete_json_with_usage(llm.SYSTEM_PROMPT, build_blocks("t", M.DocumentFacts, payload), M.DocumentFacts)
    assert res.dates[0].date == "2026-03-14" and res.amounts[0].amount == 6500.0
    assert usage.input_tokens > 0 and usage.model.startswith("mock")


def test_retry_on_validation_failure(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    calls = []
    real = llm._raw_mock

    def flaky(system, blocks, schema):
        calls.append(1)
        return ("not json", llm.Usage("mock", 1, 1)) if len(calls) == 1 else real(system, blocks, schema)

    monkeypatch.setattr(llm, "_raw_mock", flaky)
    payload = {"document_id": "d", "filename": "f", "doc_type": "other", "claimant_name": "", "text": "hello world"}
    res = llm.complete_json(llm.SYSTEM_PROMPT, build_blocks("t", M.DocumentFacts, payload), M.DocumentFacts)
    assert len(calls) == 2 and isinstance(res, M.DocumentFacts)


def test_no_policy_gives_unclear(client, claim):
    cid = claim["id"]
    client.post(f"/api/claims/{cid}/documents", files={"file": ("s.txt", b"The accident occurred on March 9, 2026 when I was rear-ended on Main Street.", "text/plain")}, data={"doc_type": "statement"})
    iid = client.post(f"/api/claims/{cid}/investigate").json()["investigation_id"]
    r = client.get(f"/api/investigations/{iid}").json()["report"]
    assert r["coverage"]["position"] == "unclear" and r["coverage"]["rationale"] == "No policy document uploaded"
    assert any(i["title"].startswith("Loss date conflict") for i in r["inconsistencies"])
