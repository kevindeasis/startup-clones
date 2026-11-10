import math
import re

from rank_bm25 import BM25Okapi

from . import db

STOP = set("""a an the and or of to in on for with is are was were be been it its this that these those what when
where who whom how why do does did you your we our us at by from as about can could would should will any there
their they them i me my not no than then so if into over under per""".split())


def tokenize(s: str) -> list[str]:
    return re.findall(r"[a-z0-9$%.]+", s.lower().replace(",", ""))


def content_tokens(s: str) -> list[str]:
    toks = [t.strip(".") for t in tokenize(s)]
    return [t for t in toks if t and t not in STOP]


def rank_chunks(query: str, chunks: list[dict], k: int = 4) -> list[dict]:
    """BM25 rank; drop chunks with insufficient query-term overlap (nothing relevant -> empty)."""
    qt = list(dict.fromkeys(content_tokens(query)))
    if not qt or not chunks:
        return []
    docs = [content_tokens(c["text"] + " " + c.get("label", "") + " " + c.get("title", "")) for c in chunks]
    bm = BM25Okapi(docs)
    scores = bm.get_scores(qt)
    scored = []
    for c, d, s in zip(chunks, docs, scores):
        dset = set(d)
        overlap = sum(1 for t in qt if t in dset)
        if overlap == 0:
            continue
        ratio = overlap / len(qt)
        if ratio < 0.5 and overlap < 3:
            continue
        # idf can be <=0 on tiny corpora; add overlap so ranking stays sane
        scored.append(({**c, "score": round(float(s), 4), "overlap": overlap}, float(s) + overlap))
    scored.sort(key=lambda x: -x[1])
    return [c for c, _ in scored[:k]]


def load_chunks(public_only: bool = False) -> list[dict]:
    sql = ("SELECT c.id, c.document_id, c.ordinal, c.label, c.text, d.title, d.public FROM chunks c "
           "JOIN documents d ON d.id=c.document_id")
    if public_only:
        sql += " WHERE d.public=1"
    return db.rows(sql + " ORDER BY c.id")


def retrieve(query: str, k: int = 4, public_only: bool = False) -> list[dict]:
    return rank_chunks(query, load_chunks(public_only), k)


def best_sentences(question: str, chunk_text: str, n: int = 2) -> list[str]:
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", chunk_text) if len(s.strip()) > 20]
    qt = set(content_tokens(question))
    scored = sorted(sents, key=lambda s: -len(qt & set(content_tokens(s))))
    chosen = scored[:n]
    return [s for s in sents if s in chosen]  # original order
