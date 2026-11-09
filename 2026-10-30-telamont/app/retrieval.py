"""BM25 lexical retrieval, cached per project."""
import re
from typing import Dict, List, Optional

from rank_bm25 import BM25Okapi
from sqlmodel import Session, select

from .models import Chunk, Document

STOP = set(
    "a an and are as at be by for from has have in is it of on or that the this to was what when which who will with shall must should".split()
)

_CACHE: Dict[int, "Index"] = {}


def tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOP]


class Index:
    def __init__(self, rows: List[dict]):
        self.rows = rows
        self.tokens = [tokenize(r["text"]) for r in rows]
        self.bm25: Optional[BM25Okapi] = BM25Okapi(self.tokens) if rows else None

    def search(self, query: str, k: int = 6) -> List[dict]:
        q = tokenize(query)
        if not self.bm25 or not q:
            return []
        scores = self.bm25.get_scores(q)
        qset = set(q)
        cands = [
            (scores[i], i) for i, toks in enumerate(self.tokens) if qset & set(toks)
        ]  # require lexical overlap (BM25 idf can be <= 0 on tiny corpora)
        cands.sort(key=lambda x: -x[0])
        return [dict(self.rows[i], score=float(s)) for s, i in cands[:k]]


def invalidate(project_id: int) -> None:
    _CACHE.pop(project_id, None)


def get_index(session: Session, project_id: int) -> Index:
    if project_id not in _CACHE:
        docs = {d.id: d for d in session.exec(select(Document).where(Document.project_id == project_id))}
        rows = []
        if docs:
            chunks = session.exec(
                select(Chunk).where(Chunk.document_id.in_(list(docs))).order_by(Chunk.document_id, Chunk.idx)
            ).all()
            for c in chunks:
                rows.append(
                    {
                        "chunk_id": c.id,
                        "document_id": c.document_id,
                        "document": docs[c.document_id].filename,
                        "page": c.page,
                        "text": c.text,
                    }
                )
        _CACHE[project_id] = Index(rows)
    return _CACHE[project_id]


def retrieve(session: Session, project_id: int, query: str, k: int = 6) -> List[dict]:
    return get_index(session, project_id).search(query, k)
