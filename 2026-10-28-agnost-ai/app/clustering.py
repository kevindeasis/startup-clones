"""Pattern discovery: TF-IDF + HDBSCAN (agglomerative fallback), plus default Feature requests / Bugs categories."""
import asyncio
import json
from collections import Counter

import numpy as np
from sklearn.cluster import HDBSCAN, AgglomerativeClustering
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import normalize
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import heuristics as H
from .analysis import refresh_pattern_stats
from .llm import LLM
from .models import Conversation, ConversationAnalysis, Pattern, PatternMember, utcnow

OTHER_NAME = "Other / long tail"
DUP_THRESHOLD = 0.6


def _labels(X: np.ndarray) -> np.ndarray:
    n = X.shape[0]
    labels = np.full(n, -1)
    if n >= 3:
        try:
            labels = HDBSCAN(min_cluster_size=3, metric="euclidean", copy=True).fit_predict(X)
        except Exception:
            labels = np.full(n, -1)
    if len(set(labels) - {-1}) < 2 and n >= 2:
        k = min(8, max(2, n // 8))
        labels = AgglomerativeClustering(n_clusters=min(k, n), metric="cosine", linkage="average").fit_predict(X)
    return labels


def group_near_duplicates(items: list[tuple[str, str]]) -> list[dict]:
    """items: (conversation_id, text). Returns groups [{canonical, members:[(conv_id, score, original)]}]."""
    if not items:
        return []
    norm = [H.normalize_for_grouping(t) or t.lower() for _, t in items]
    uniq = sorted(set(norm), key=lambda s: (-norm.count(s), s))
    if len(uniq) == 1:
        sims = np.ones((1, 1))
    else:
        try:
            X = TfidfVectorizer(ngram_range=(1, 1)).fit_transform(uniq)
            sims = cosine_similarity(X)
        except ValueError:
            sims = np.eye(len(uniq))
    leader_of: dict[str, int] = {}
    leaders: list[int] = []
    for i in range(len(uniq)):
        for li in leaders:
            if sims[i, li] >= DUP_THRESHOLD:
                leader_of[uniq[i]] = li
                break
        else:
            leaders.append(i)
            leader_of[uniq[i]] = i
    idx = {u: i for i, u in enumerate(uniq)}
    groups: dict[int, dict] = {}
    for (cid, orig), n in zip(items, norm):
        li = leader_of[n]
        g = groups.setdefault(li, {"members": []})
        g["members"].append((cid, float(sims[idx[n], li]), orig))
    out = []
    for g in groups.values():
        cnt = Counter(o for _, _, o in g["members"])
        g["canonical"] = sorted(cnt, key=lambda o: (-cnt[o], len(o), o))[0]
        out.append(g)
    out.sort(key=lambda g: -len(g["members"]))
    return out


async def recluster(db: Session, llm: LLM) -> dict:
    for p in db.scalars(select(Pattern).where(Pattern.kind.in_(["cluster", "feature_requests", "bugs"]))).all():
        db.delete(p)
    db.commit()

    rows = db.execute(
        select(ConversationAnalysis, Conversation.user_id).join(Conversation, Conversation.id == ConversationAnalysis.conversation_id)
        .order_by(ConversationAnalysis.conversation_id)
    ).all()
    analyses = [r[0] for r in rows]
    clusters_made = 0

    if analyses:
        texts = [f"{a.intent}. {a.summary}" for a in analyses]
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, stop_words="english")
        try:
            Xs = vec.fit_transform(texts)
            Xs = normalize(Xs, norm="l2")
            X = Xs.toarray()
            terms = np.array(vec.get_feature_names_out())
            labels = _labels(X)
        except ValueError:  # empty vocabulary
            X, terms, labels = np.zeros((len(analyses), 1)), np.array(["misc"]), np.full(len(analyses), -1)

        specs = []
        for lab in sorted(set(labels)):
            idxs = [i for i, l in enumerate(labels) if l == lab]
            centroid = X[idxs].mean(axis=0)
            top = [str(terms[j]) for j in np.argsort(-centroid)[:8] if centroid[j] > 0] if lab != -1 else []
            intents = list(dict.fromkeys(analyses[i].intent for i in idxs))[:6]
            specs.append((lab, idxs, centroid, top, intents))

        named = await asyncio.gather(*(llm.name_cluster(top, intents) if lab != -1 else _noop() for lab, _, _, top, intents in specs))
        for (lab, idxs, centroid, top, intents), nm in zip(specs, named):
            p = Pattern(kind="cluster", name=OTHER_NAME if lab == -1 else nm.name,
                        description="Conversations that did not fit a larger pattern." if lab == -1 else nm.description,
                        top_terms_json=json.dumps(top))
            db.add(p)
            db.flush()
            cn = np.linalg.norm(centroid) or 1.0
            for i in idxs:
                sc = float(X[i] @ centroid / cn) if lab != -1 else 0.0
                db.add(PatternMember(pattern_id=p.id, conversation_id=analyses[i].conversation_id, score=round(sc, 3)))
            refresh_pattern_stats(db, p)
            clusters_made += 1

    counts = {}
    for kind, name, desc, attr in (
        ("feature_requests", "Feature requests", "Features users asked for that the assistant said it cannot do.", "feature_requests_json"),
        ("bugs", "Bugs", "Things users report as broken.", "bug_reports_json"),
    ):
        items = [(a.conversation_id, t) for a in analyses for t in json.loads(getattr(a, attr) or "[]")]
        groups = group_near_duplicates(items)
        p = Pattern(kind=kind, name=name, description=desc)
        db.add(p)
        db.flush()
        seen = set()
        for g in groups:
            for cid, sc, _orig in g["members"]:
                if (cid, g["canonical"]) in seen:
                    continue
                seen.add((cid, g["canonical"]))
                db.add(PatternMember(pattern_id=p.id, conversation_id=cid, score=round(sc, 3), group_text=g["canonical"]))
        refresh_pattern_stats(db, p)
        counts[kind] = len(groups)
    db.commit()
    return {"patterns": clusters_made + 2, "clusters": clusters_made,
            "feature_groups": counts["feature_requests"], "bug_groups": counts["bugs"]}


async def _noop():
    return None
