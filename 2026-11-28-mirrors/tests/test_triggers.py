import pytest
from pydantic import ValidationError

from steer.models import Trigger
from steer.triggers import eval_condition, evaluate, preview
from tests.conftest import discount_messages, make_trace, msg


def T(messages=None, **kw):
    return make_trace(messages=messages or discount_messages(), **kw)


def test_message_matches_last_and_any():
    tr = T()
    assert eval_condition({"type": "message_matches", "role": "user", "pattern": "NO THANKS", "where": "last"}, tr)
    assert not eval_condition({"type": "message_matches", "role": "user", "pattern": "want to cancel", "where": "last"}, tr)
    assert eval_condition({"type": "message_matches", "role": "user", "pattern": "want to cancel", "where": "any"}, tr)
    assert not eval_condition({"type": "message_matches", "role": "assistant", "pattern": "no thanks"}, tr)


def test_tool_called_min_count():
    tr = T()
    assert eval_condition({"type": "tool_called", "name": "offer_discount"}, tr)
    assert not eval_condition({"type": "tool_called", "name": "offer_discount", "min_count": 2}, tr)
    assert not eval_condition({"type": "tool_called", "name": "cancel_subscription"}, tr)


def test_tool_result_matches():
    tr = T()
    assert eval_condition({"type": "tool_result_matches", "name": "offer_discount", "pattern": "offered.*true"}, tr)
    assert not eval_condition({"type": "tool_result_matches", "name": "offer_discount", "pattern": "declined"}, tr)
    assert not eval_condition({"type": "tool_result_matches", "name": "other", "pattern": "offered"}, tr)


def test_segment_entry_point_turn_index():
    tr = T(segment="pro", entry="chat", rev=3)
    assert eval_condition({"type": "user_segment", "in": ["pro", "enterprise"]}, tr)
    assert not eval_condition({"type": "user_segment", "in": ["free"]}, tr)
    assert eval_condition({"type": "entry_point", "in": ["chat"]}, tr)
    assert not eval_condition({"type": "entry_point", "in": ["email"]}, tr)
    assert eval_condition({"type": "turn_index_min", "value": 3}, tr)
    assert not eval_condition({"type": "turn_index_min", "value": 4}, tr)


def test_invalid_regex_and_empty_trigger_rejected():
    with pytest.raises(ValidationError):
        Trigger.model_validate({"all": [{"type": "message_matches", "pattern": "(unclosed"}]})
    with pytest.raises(ValidationError):
        Trigger.model_validate({})


def test_situation_classifier_and_fail_closed():
    trig = {"all": [], "situation": "refund", "situation_keywords": ["refund"]}
    assert evaluate(trig, T(), lambda t, s, k: (True, "y"))["matched"]
    assert not evaluate(trig, T(), lambda t, s, k: (False, "n"))["matched"]

    def boom(*a):
        raise TimeoutError("slow")
    ev = evaluate(trig, T(), boom)
    assert not ev["matched"] and ev["error"]


def test_preview_exclusions_and_conflicts():
    trig = {"all": [{"type": "tool_called", "name": "offer_discount"},
                    {"type": "message_matches", "role": "user", "pattern": "no thanks", "where": "last"}]}
    rows = [({"trace_id": "a", "conversation_id": "c1", "revision": 1, "outcome_success": 0}, T()),
            ({"trace_id": "b", "conversation_id": "c2", "revision": 1, "outcome_success": 1}, T(discount_messages(False))),
            ({"trace_id": "c", "conversation_id": "c3", "revision": 1, "outcome_success": 1},
             make_trace(messages=[msg("user", "hi")]))]
    other = [{"id": "other", "title": "Other", "trigger": {"all": [{"type": "tool_called", "name": "offer_discount"}]}}]
    res = preview(trig, rows, None, other)
    assert [m["trace_id"] for m in res["matched"]] == ["a"]
    assert [m["trace_id"] for m in res["exclusions"]] == ["b"]
    assert res["exclusions"][0]["failed_conditions"]
    assert res["conflicts"][0]["correction_id"] == "other"
