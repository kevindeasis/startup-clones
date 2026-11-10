import json
from pathlib import Path

from . import db, ingest

DEMO = Path(__file__).parent / "demo_data"
DOCS = [  # (file, title, kind, public)
    ("q3_earnings_script.md", "Q3 2026 Earnings Script", "earnings script", True),
    ("q3_press_release.md", "Q3 2026 Press Release", "press release", True),
    ("fy2026_guidance.md", "FY2026 Guidance", "guidance", True),
    ("10k_risk_factors_excerpt.md", "10-K Risk Factors Excerpt", "10-K excerpt", True),
    ("internal_qa_prep.md", "Internal Analyst Q&A Prep", "q&a prep", False),
]


def load_demo() -> dict:
    existing = {d["title"] for d in db.rows("SELECT title FROM documents")}
    added_docs = 0
    for fn, title, kind, public in DOCS:
        if title in existing:
            continue
        ingest.ingest_file(fn, (DEMO / fn).read_bytes(), kind, public, title)
        added_docs += 1
    added_inv = 0
    for inv in json.loads((DEMO / "investors.json").read_text()):
        with db.connect() as c:
            if c.execute("SELECT 1 FROM investors WHERE name=?", (inv["name"],)).fetchone():
                continue
            iid = c.execute("INSERT INTO investors(name, style, aum_musd, mandate, sectors, holds_us, created_at) VALUES(?,?,?,?,?,?,?)",
                            (inv["name"], inv["style"], inv["aum_musd"], inv["mandate"], inv["sectors"], int(inv["holds_us"]), db.now())).lastrowid
            for it in inv.get("interactions", []):
                c.execute("INSERT INTO interactions(investor_id,date,summary,sentiment) VALUES(?,?,?,?)",
                          (iid, it["date"], it["summary"], it["sentiment"]))
            added_inv += 1
    return {"documents_added": added_docs, "investors_added": added_inv}
