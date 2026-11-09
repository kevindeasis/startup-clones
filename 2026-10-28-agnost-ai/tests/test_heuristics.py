from app import heuristics as H


def msgs(*texts):
    out = []
    for i, t in enumerate(texts):
        out.append({"role": "user" if i % 2 == 0 else "assistant", "content": t})
    return out


def test_jaccard_basic():
    assert H.jaccard("make the video brighter", "make the video brighter please") >= 0.5
    assert H.jaccard("add subtitles", "export in 4k") < 0.5


def test_rephrase_detected():
    m = msgs("make the intro shorter", "done", "make the intro shorter please", "done", "make the intro shorter right now")
    assert H.compute_hints(m)["rephrase_count"] == 2
    assert H.rephrase_pairs(m) == [(0, 2), (2, 4)]


def test_no_rephrase_for_different_requests():
    m = msgs("trim the clip", "ok", "add some music to the soundtrack")
    assert H.compute_hints(m)["rephrase_count"] == 0


def test_hints_caps_exclaim_profanity_end():
    m = msgs("THIS IS USELESS!! wtf")
    h = H.compute_hints(m)
    assert h["caps_ratio"] > 0.6 and h["exclamation_count"] == 2
    assert h["profanity_hit"] is True and h["ended_on_user_turn"] is True and h["user_message_count"] == 1


def test_ended_on_assistant_turn():
    assert H.compute_hints(msgs("hi", "hello"))["ended_on_user_turn"] is False


def test_message_flags_marks_rephrase_pair_and_correction():
    m = msgs("make it brighter", "done", "make it brighter please", "ok", "No, I meant the other clip")
    f = H.message_flags(m)
    assert "rephrase" in f[0] and "rephrase" in f[2] and "correction" in f[4]


def test_normalization_groups_synonyms():
    assert H.normalize_for_grouping("automatic captions") == H.normalize_for_grouping("auto subtitles")
