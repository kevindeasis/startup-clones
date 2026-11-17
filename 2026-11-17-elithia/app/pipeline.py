"""Pagination and chronology pipelines (run as background tasks)."""
import json
import threading
import traceback
from pathlib import Path

import pymupdf
from rapidfuzz import fuzz

from . import config, db, pdfutil
from .llm import get_llm

NEAR_DUP_RATIO = 97
NEAR_DUP_MIN_CHARS = 200
CLASSIFY_BATCH = 10
EVENT_BATCH_CHARS = 6000

PROGRESS: dict[int, dict] = {}
_lock = threading.Lock()


def set_progress(case_id, **kw):
    with _lock:
        PROGRESS.setdefault(case_id, {"stage": "idle", "done": 0, "total": 0, "message": ""}).update(kw)


def get_progress(case_id):
    with _lock:
        return dict(PROGRESS.get(case_id) or {"stage": "idle", "done": 0, "total": 0, "message": ""})


def record_run(r: dict):
    db.execute("INSERT INTO llm_runs(case_id,purpose,model,mode,input_chars,output_chars,latency_ms,created_at) "
               "VALUES(?,?,?,?,?,?,?,?)", (r["case_id"], r["purpose"], r["model"], r["mode"], r["input_chars"],
                                           r["output_chars"], r["latency_ms"], db.now()))


# ------------------------------------------------------------------ pure helpers (unit-tested)
def find_duplicates(pages: list[dict]):
    """pages: dicts with id, text, is_blank (in canonical order). Returns {page_id: (dup_of_id, reason)}.
    First occurrence is canonical. Exact = same normalised-text hash; near = rapidfuzz ratio >= 97."""
    seen_hash: dict[str, int] = {}
    kept: list[tuple[int, str]] = []
    out = {}
    for p in pages:
        if p.get("is_blank"):
            continue
        h = pdfutil.text_hash(p["text"])
        if h in seen_hash:
            out[p["id"]] = (seen_hash[h], "exact duplicate")
            continue
        norm = pdfutil.norm_text(p["text"])
        dup = None
        if len(norm) >= NEAR_DUP_MIN_CHARS:
            for kid, knorm in kept:
                if abs(len(knorm) - len(norm)) > 0.1 * max(len(norm), 1):
                    continue
                r = fuzz.ratio(norm, knorm)
                if r >= NEAR_DUP_RATIO:
                    dup = (kid, f"near-duplicate ({r:.0f}% similar)")
                    break
        if dup:
            out[p["id"]] = dup
            continue
        seen_hash[h] = p["id"]
        kept.append((p["id"], norm))
    return out


def group_documents(pages: list[dict]) -> list[list[dict]]:
    """pages: kept pages in original order with classification. A new document starts on a 'first' page,
    on a file change, or when a continuation's doc_type differs from the open document's."""
    docs, cur = [], None
    for p in pages:
        new = (cur is None or p["page_role"] != "continuation" or p["file_id"] != cur[-1]["file_id"]
               or (p["doc_type"] not in (None, "other") and p["doc_type"] != cur[0]["doc_type"]))
        if new:
            cur = [p]
            docs.append(cur)
        else:
            cur.append(p)
    return docs


def order_documents(docs: list[list[dict]]) -> list[dict]:
    """Return doc dicts ordered by service_date (undated last); each has 'pages' (original order)."""
    out = []
    for d in docs:
        first = d[0]
        sdate = next((p["service_date"] for p in d if p.get("service_date")), None)
        out.append(dict(doc_type=first["doc_type"] or "other", facility=next((p["facility"] for p in d if p.get("facility")), None),
                        provider=next((p["provider"] for p in d if p.get("provider")), None),
                        service_date=sdate, undated=0 if sdate else 1, pages=d,
                        confidence=min((p.get("confidence") or 0) for p in d)))
    out.sort(key=lambda x: (x["undated"], x["service_date"] or "", x["pages"][0]["file_id"], x["pages"][0]["page_index"]))
    return out


def assign_bates(ordered_docs: list[dict], start: int = 1):
    """Assign contiguous CHR-000001... numbers in final document/page order. Mutates pages with 'bates'."""
    n = start
    for d in ordered_docs:
        for p in d["pages"]:
            p["bates"] = f"CHR-{n:06d}"
            n += 1
        d["bates_start"], d["bates_end"] = d["pages"][0]["bates"], d["pages"][-1]["bates"]
    return ordered_docs


def make_batches(pages: list[dict], max_chars=EVENT_BATCH_CHARS) -> list[list[dict]]:
    batches, cur, size = [], [], 0
    for p in pages:
        L = len(p["text"] or "")
        if cur and size + L > max_chars:
            batches.append(cur)
            cur, size = [], 0
        cur.append(p)
        size += L
    if cur:
        batches.append(cur)
    return batches


def event_sort_key(e):
    return (e.get("date") or "9999-99-99", e.get("time") or "99:99", e.get("id") or 0)


# ------------------------------------------------------------------ paginate
def paginate_case(case_id: int):
    set_progress(case_id, stage="paginating", done=0, total=0, message="Reading PDFs")
    db.execute("UPDATE cases SET status='paginating' WHERE id=?", (case_id,))
    try:
        _paginate(case_id)
        db.execute("UPDATE cases SET status='paginated' WHERE id=?", (case_id,))
        set_progress(case_id, stage="idle", message="Pagination complete")
    except Exception as e:  # pragma: no cover
        traceback.print_exc()
        db.execute("UPDATE cases SET status='error' WHERE id=?", (case_id,))
        set_progress(case_id, stage="error", message=f"{type(e).__name__}: {e}")


def _paginate(case_id: int):
    with db.conn() as c:
        for t in ("events", "conflicts", "documents", "pages"):
            c.execute(f"DELETE FROM {t} WHERE case_id=?", (case_id,))
    files = db.q("SELECT * FROM files WHERE case_id=? ORDER BY id", (case_id,))
    # 1. split into pages, extract text, flag blanks
    for f in files:
        with pymupdf.open(f["path"]) as doc:
            rows = []
            for i, page in enumerate(doc):
                text = pdfutil.extract_text(page)
                blank = pdfutil.is_blank(page, text)
                rows.append((case_id, f["id"], i, text, pdfutil.text_hash(text), 1 if blank else 0))
            with db.conn() as c:
                c.executemany("INSERT INTO pages(case_id,file_id,page_index,text,text_hash,is_blank) VALUES(?,?,?,?,?,?)", rows)
                c.execute("UPDATE files SET page_count=? WHERE id=?", (len(rows), f["id"]))
    pages = db.q("SELECT id,file_id,page_index,text,is_blank FROM pages WHERE case_id=? ORDER BY file_id,page_index", (case_id,))
    set_progress(case_id, total=len(pages), done=0, message=f"{len(pages)} pages read")
    # 2. duplicates
    dups = find_duplicates(pages)
    with db.conn() as c:
        for pid, (of, reason) in dups.items():
            c.execute("UPDATE pages SET is_duplicate=1, duplicate_of=?, dup_reason=? WHERE id=?", (of, reason, pid))
        for p in pages:
            if p["is_blank"]:
                c.execute("UPDATE pages SET dup_reason='blank page' WHERE id=?", (p["id"],))
    kept = [p for p in pages if not p["is_blank"] and p["id"] not in dups]
    # 3. classify in batches
    llm = get_llm(case_id, record_run)
    cls = {}
    for i in range(0, len(kept), CLASSIFY_BATCH):
        batch = kept[i:i + CLASSIFY_BATCH]
        res = llm.classify_pages([{"key": str(p["id"]), "text": p["text"]} for p in batch])
        for r in res:
            cls[int(r.key)] = r
        set_progress(case_id, done=min(i + CLASSIFY_BATCH, len(kept)), total=len(kept), message="Classifying pages")
    for p in kept:
        r = cls[p["id"]]
        p.update(doc_type=r.doc_type, facility=r.facility, provider=r.provider, service_date=r.service_date,
                 page_role=r.page_role, confidence=r.confidence)
    # 4. group, order, Bates
    ordered = assign_bates(order_documents(group_documents(kept)))
    with db.conn() as c:
        for idx, d in enumerate(ordered):
            cur = c.execute("INSERT INTO documents(case_id,doc_type,facility,provider,service_date,bates_start,bates_end,order_index,undated)"
                            " VALUES(?,?,?,?,?,?,?,?,?)", (case_id, d["doc_type"], d["facility"], d["provider"], d["service_date"],
                                                           d["bates_start"], d["bates_end"], idx, d["undated"]))
            did = cur.lastrowid
            for p in d["pages"]:
                c.execute("UPDATE pages SET doc_type=?,facility=?,provider=?,service_date=?,page_role=?,confidence=?,document_id=?,bates=? WHERE id=?",
                          (p["doc_type"], p["facility"], p["provider"], p["service_date"], p["page_role"], p["confidence"], did, p["bates"], p["id"]))


# ------------------------------------------------------------------ chronology
def build_chronology(case_id: int):
    set_progress(case_id, stage="chronology", done=0, total=0, message="Starting")
    db.execute("UPDATE cases SET status='building' WHERE id=?", (case_id,))
    try:
        _chronology(case_id)
        db.execute("UPDATE cases SET status='ready' WHERE id=?", (case_id,))
        set_progress(case_id, stage="idle", message="Chronology complete")
    except Exception as e:  # pragma: no cover
        traceback.print_exc()
        db.execute("UPDATE cases SET status='error' WHERE id=?", (case_id,))
        set_progress(case_id, stage="error", message=f"{type(e).__name__}: {e}")


def _chronology(case_id: int):
    docs = db.q("SELECT * FROM documents WHERE case_id=? ORDER BY order_index", (case_id,))
    if not docs:
        raise RuntimeError("No documents: run pagination first")
    # keep user-created events; replace LLM events and conflicts
    with db.conn() as c:
        c.execute("DELETE FROM events WHERE case_id=? AND created_by='llm'", (case_id,))
        c.execute("DELETE FROM conflicts WHERE case_id=?", (case_id,))
    llm = get_llm(case_id, record_run)
    work = []
    for d in docs:
        pgs = db.q("SELECT id,text,bates FROM pages WHERE document_id=? ORDER BY page_index, id", (d["id"],))
        pgs.sort(key=lambda p: p["bates"])
        for b in make_batches(pgs):
            work.append((d, b))
    set_progress(case_id, total=len(work) + 1, done=0, message="Extracting events")
    for n, (d, b) in enumerate(work, 1):
        events = llm.extract_events(dict(doc_type=d["doc_type"], facility=d["facility"], provider=d["provider"],
                                         service_date=d["service_date"],
                                         pages=[{"bates": p["bates"], "text": p["text"]} for p in b]))
        with db.conn() as c:
            for e in events:
                c.execute("INSERT INTO events(case_id,document_id,date,time,facility,provider,category,summary,significance,quote,"
                          "source_pages,verified,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,'llm',?)",
                          (case_id, d["id"], e.date, e.time, e.facility or d["facility"], e.provider or d["provider"], e.category,
                           e.summary, e.significance, e.quote, json.dumps(e.source_pages), db.now()))
        set_progress(case_id, done=n, message=f"Extracted events from batch {n}/{len(work)}")
    # conflict pass over the sorted event list
    set_progress(case_id, message="Checking for conflicts")
    evs = db.q("SELECT * FROM events WHERE case_id=?", (case_id,))
    evs.sort(key=event_sort_key)
    for conf in llm.find_conflicts(evs):
        db.execute("INSERT INTO conflicts(case_id,event_ids,description,resolved) VALUES(?,?,?,0)",
                   (case_id, json.dumps(conf.event_ids), conf.description))
    set_progress(case_id, done=len(work) + 1)
