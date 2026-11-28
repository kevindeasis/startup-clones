from steer.db import Database
from steer.report import build_report


def seed(db, group_results):
    a = db.create_agent("a", "active")
    c = db.create_correction(a["id"], "t", "g", {"all": [{"type": "tool_called", "name": "x"}]})
    for i, (group, success) in enumerate(group_results):
        conv = f"conv{i}"
        db.add_delivery(c["id"], f"tr{i}", conv, group, group == "treatment", "active")
        db.upsert_turn(a["id"], {"id": f"tr{i}", "conversationId": conv, "conversationRevision": 1,
                                 "messages": [{"role": "user", "content": "hi"}]}, True, "completed",
                       None if success is None else {"success": success})
    return c


def test_report_math():
    db = Database(":memory:")
    c = seed(db, [("treatment", True)] * 3 + [("treatment", False)] + [("holdout", True)] + [("holdout", False)] * 3
             + [("holdout", None)])
    r = build_report(db, c)
    assert r["treatment"] == {"conversations": 4, "successes": 3, "pending": 0, "rate": 0.75}
    assert r["holdout"]["conversations"] == 4 and r["holdout"]["successes"] == 1 and r["holdout"]["pending"] == 1
    assert r["holdout"]["rate"] == 0.25 and r["lift"] == 0.5
    assert r["deliveries"] == 4


def test_report_empty_groups():
    db = Database(":memory:")
    c = seed(db, [])
    r = build_report(db, c)
    assert r["lift"] is None and r["treatment"]["rate"] is None


def test_shadow_deliveries_excluded():
    db = Database(":memory:")
    a = db.create_agent("a")
    c = db.create_correction(a["id"], "t", "g", {"all": [{"type": "tool_called", "name": "x"}]})
    db.add_delivery(c["id"], "t", "conv", "treatment", False, "shadow")
    r = build_report(db, c)
    assert r["treatment"]["conversations"] == 0 and r["shadow_matched_conversations"] == 1
