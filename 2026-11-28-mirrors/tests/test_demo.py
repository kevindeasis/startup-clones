from examples.demo import main


def test_demo_end_to_end(capsys):
    code = main(["--serve", "--port", "0", "--baseline", "30", "--after", "40"])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "RESULT: PASS" in out and "treatment" in out and "holdout" in out
