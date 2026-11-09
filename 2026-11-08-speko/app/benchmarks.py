"""Benchmark harness: runs eval sets through providers and persists rows."""
from datetime import datetime, timezone

import jiwer

from . import config
from .data import EVAL_SETS, LANGUAGES, normalize_text
from .db import conn
from .providers import (list_providers, make_eval_audio, mock_quality, heuristic_llm_score)

SAMPLE_TEXT_FOR_TTS = EVAL_SETS


def _bench_stt(p, lang):
    refs, hyps, lat, cost = [], [], [], []
    for i, ref in enumerate(EVAL_SETS[lang]):
        out = p.call(language=lang, audio=make_eval_audio(lang, i))
        refs.append(normalize_text(ref))
        hyps.append(normalize_text(out.output) or "x")
        lat.append(out.latency_ms)
        cost.append(out.cost_usd)
    wer = min(1.0, max(0.0, float(jiwer.wer(refs, hyps))))
    return 1.0 - wer, lat, cost


def _bench_llm(p, lang):
    q, lat, cost = [], [], []
    for i, prompt in enumerate(EVAL_SETS[lang]):
        out = p.call(language=lang, text=prompt)
        q.append(mock_quality(p.name, "llm", lang, str(i)) if p.is_mock else heuristic_llm_score(out.output, lang))
        lat.append(out.latency_ms)
        cost.append(out.cost_usd)
    return sum(q) / len(q), lat, cost


def _bench_tts(p, lang):
    q, lat, cost = [], [], []
    for i, sentence in enumerate(EVAL_SETS[lang]):
        out = p.call(language=lang, text=sentence)
        # naturalness cannot be judged automatically: seeded for mocks, constant placeholder for real providers
        q.append(mock_quality(p.name, "tts", lang, str(i)) if p.is_mock else 0.5)
        lat.append(out.latency_ms)
        cost.append(out.cost_usd)
    return sum(q) / len(q), lat, cost


def run_benchmark(languages=None, stages=None) -> dict:
    languages = list(languages or LANGUAGES)
    stages = list(stages or config.SUPPORTED_STAGES)
    run_at = datetime.now(timezone.utc).isoformat()
    inserted, skipped = 0, []
    with conn() as c:
        for stage in stages:
            for lang in languages:
                for p in list_providers(stage):
                    if stage == "stt" and not p.is_mock:
                        skipped.append({"provider": p.name, "stage": stage, "language": lang,
                                        "reason": "no real benchmark audio corpus; real STT ranks last until data exists"})
                        continue
                    try:
                        q, lat, cost = {"stt": _bench_stt, "llm": _bench_llm, "tts": _bench_tts}[stage](p, lang)
                    except Exception as e:  # a failing real provider must not abort the run
                        skipped.append({"provider": p.name, "stage": stage, "language": lang, "reason": str(e)[:200]})
                        continue
                    n = len(lat)
                    c.execute("INSERT INTO benchmark_results(provider,stage,language,metric_quality,latency_ms,cost_usd,n_samples,run_at)"
                              " VALUES(?,?,?,?,?,?,?,?)",
                              (p.name, stage, lang, round(q, 6), round(sum(lat) / n, 2), sum(cost) / n, n, run_at))
                    inserted += 1
    return {"run_at": run_at, "rows_inserted": inserted, "skipped": skipped, "mock_mode": config.mock_mode()}


def latest_rows(stage=None, language=None) -> list[dict]:
    """Latest result per (provider, stage, language), ranked by quality then latency."""
    sql = ("SELECT b.* FROM benchmark_results b JOIN (SELECT MAX(id) mid FROM benchmark_results GROUP BY provider, stage, language) m"
           " ON b.id = m.mid WHERE 1=1")
    args = []
    if stage:
        sql += " AND b.stage=?"
        args.append(stage)
    if language:
        sql += " AND b.language=?"
        args.append(language)
    with conn() as c:
        rows = [dict(r) for r in c.execute(sql, args).fetchall()]
    for r in rows:
        r["wer"] = round(1.0 - r["metric_quality"], 6) if r["stage"] == "stt" else None
    rows.sort(key=lambda r: (r["stage"], r["language"], -r["metric_quality"], r["latency_ms"]))
    rank, prev = 0, None
    for r in rows:
        key = (r["stage"], r["language"])
        rank = 1 if key != prev else rank + 1
        r["rank"], prev = rank, key
    return rows


def count_rows() -> int:
    with conn() as c:
        return c.execute("SELECT COUNT(*) FROM benchmark_results").fetchone()[0]
