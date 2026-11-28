from steer.holdout import assign


def test_deterministic():
    assert all(assign("conv-1", "cor", 50) == assign("conv-1", "cor", 50) for _ in range(5))


def test_roughly_even_split():
    n = sum(assign(f"conv-{i}", "cor_x", 50) == "holdout" for i in range(1000))
    assert 430 <= n <= 570


def test_extremes():
    assert all(assign(f"c{i}", "x", 0) == "treatment" for i in range(100))
    assert all(assign(f"c{i}", "x", 100) == "holdout" for i in range(100))
