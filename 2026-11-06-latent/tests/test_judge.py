from app.judge import MockJudge, split_sentences

SRC = ["Q3 revenue was $3.1M, up 12% year over year.", "The company has 42 employees."]


def test_flags_fabricated_number():
    r = MockJudge().score("q", "Q3 revenue was $4.2M.", SRC)
    assert r.failure_type == "unsupported_number" and r.score > 0.5
    assert r.source_sentence == SRC[0]


def test_flags_invented_name():
    r = MockJudge().score("q", "Q3 revenue was $3.1M, said Dana Whitfield.", SRC)
    assert r.failure_type == "invented_name"


def test_flags_wrong_date():
    r = MockJudge().score("q", "The company was founded in 2019.", SRC)
    assert r.failure_type == "wrong_date"


def test_grounded_passes():
    r = MockJudge().score("q", "Q3 revenue was $3.1M, up 12% year over year.", SRC)
    assert r.failure_type == "none" and r.score < 0.5 and r.risky_sentence is None


def test_unsupported_claim():
    r = MockJudge().score("q", "Our product dominates the global semiconductor market easily.", SRC)
    assert r.failure_type == "unsupported_claim"


def test_split_sentences():
    assert split_sentences("One. Two! Three?") == ["One.", "Two!", "Three?"]


def test_anthropic_judge_tolerant_parse_and_fallback():
    from app.config import get_settings
    from app.judge import AnthropicJudge

    j = AnthropicJudge.__new__(AnthropicJudge)
    j._model = "m"
    j._fallback = MockJudge()

    class Block:
        type = "text"

        def __init__(self, t):
            self.text = t

    class Client:
        def __init__(self, t):
            self.messages = self
            self.t = t

        def create(self, **kw):
            return type("R", (), {"content": [Block(self.t)]})()

    j._client = Client('noise {"hallucination_probability": 0.9, "riskiest_sentence_index": 0, '
                       '"most_relied_source_index": 1, "failure_type": "invented_name", "sentences": []} tail')
    r = j.score("q", "Bad claim here.", SRC)
    assert r.score == 0.9 and r.risky_sentence == "Bad claim here." and r.source_sentence == SRC[1]
    j._client = Client("not json at all")
    r = j.score("q", "Q3 revenue was $4.2M.", SRC)
    assert r.explanation == "judge output unparseable; heuristic fallback"
    assert get_settings() is not None
