"""Branded DOCX (python-docx) and PDF (reportlab) report export."""
import io
from datetime import date
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import db
from .pipeline import event_sort_key


def case_stats(case_id: int) -> dict:
    pages = db.q("SELECT is_blank,is_duplicate FROM pages WHERE case_id=?", (case_id,))
    events = db.q("SELECT verified FROM events WHERE case_id=?", (case_id,))
    nd = db.q("SELECT COUNT(*) n FROM documents WHERE case_id=?", (case_id,), one=True)["n"]
    ver = sum(1 for e in events if e["verified"])
    return dict(pages_in=len(pages), blanks=sum(1 for p in pages if p["is_blank"]),
                duplicates=sum(1 for p in pages if p["is_duplicate"]), documents=nd, events=len(events),
                verified=ver, pct_verified=round(100 * ver / len(events)) if events else 0,
                llm_runs=db.q("SELECT COUNT(*) n FROM llm_runs WHERE case_id=?", (case_id,), one=True)["n"])


def load_events(case_id: int) -> list[dict]:
    evs = db.q("SELECT * FROM events WHERE case_id=?", (case_id,))
    for e in evs:
        e["source_pages"] = db.jloads(e["source_pages"], [])
    evs.sort(key=event_sort_key)
    return evs


def gather(case_id: int) -> dict:
    case = db.q("SELECT * FROM cases WHERE id=?", (case_id,), one=True)
    if not case:
        return None
    st = case_stats(case_id)
    return dict(case=case, stats=st, documents=db.q("SELECT * FROM documents WHERE case_id=? ORDER BY order_index", (case_id,)),
                events=load_events(case_id),
                conflicts=[c for c in db.q("SELECT * FROM conflicts WHERE case_id=? ORDER BY id", (case_id,)) if not c["resolved"]],
                draft=not (st["events"] > 0 and st["pct_verified"] == 100), prepared=date.today().strftime("%B %d, %Y"))


def _stat_lines(st):
    return [("Pages received", st["pages_in"]), ("Blank pages removed", st["blanks"]),
            ("Duplicate pages removed", st["duplicates"]), ("Documents", st["documents"]),
            ("Chronology events", st["events"]), ("Verified", f"{st['verified']} ({st['pct_verified']}%)")]


def _cite(e):
    return ", ".join(e["source_pages"]) or "-"


def _ev_label(e):
    return (e["date"] or "undated") + ((" " + e["time"]) if e.get("time") else "")


# ------------------------------------------------------------------ DOCX
def build_docx(case_id: int) -> bytes:
    g = gather(case_id)
    case, st = g["case"], g["stats"]
    d = Document()
    t = d.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(case["firm_name"] or "")
    r.bold = True
    r.font.size = Pt(16)
    for _ in range(3):
        d.add_paragraph()
    h = d.add_heading(case["report_title"] or "Medical Chronology", 0)
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line in (f"Case: {case['name']}", f"Claimant: {case['claimant'] or '-'}", f"Matter type: {case['matter_type'] or '-'}",
                 f"Prepared: {g['prepared']}"):
        p = d.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if g["draft"]:
        p = d.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run("Draft — pending expert sign-off")
        r.bold = True
        r.font.color.rgb = RGBColor(0xB0, 0x30, 0x30)
    d.add_page_break()
    d.add_heading("Summary", 1)
    tb = d.add_table(rows=0, cols=2)
    tb.style = "Light Grid Accent 1"
    for k, v in _stat_lines(st):
        row = tb.add_row().cells
        row[0].text, row[1].text = k, str(v)
    d.add_heading("Paginated record index", 1)
    tb = d.add_table(rows=1, cols=4)
    tb.style = "Light Grid Accent 1"
    for i, hname in enumerate(("Bates range", "Document type", "Facility", "Date")):
        tb.rows[0].cells[i].text = hname
    for doc in g["documents"]:
        c = tb.add_row().cells
        c[0].text = f"{doc['bates_start']} - {doc['bates_end']}"
        c[1].text, c[2].text, c[3].text = doc["doc_type"] or "", doc["facility"] or "", doc["service_date"] or "undated"
    d.add_page_break()
    d.add_heading("Chronology", 1)
    tb = d.add_table(rows=1, cols=6)
    tb.style = "Light Grid Accent 1"
    for i, hname in enumerate(("Date", "Category", "Facility / provider", "Summary", "Sig.", "Citations")):
        tb.rows[0].cells[i].text = hname
    for e in g["events"]:
        c = tb.add_row().cells
        c[0].text, c[1].text = _ev_label(e), e["category"] or ""
        c[2].text = " / ".join(x for x in (e["facility"], e["provider"]) if x)
        c[3].text = e["summary"] + ("  [verified]" if e["verified"] else "")
        c[4].text, c[5].text = e["significance"] or "", _cite(e)
    d.add_heading("Unresolved conflicts", 1)
    if not g["conflicts"]:
        d.add_paragraph("None.")
    for cf in g["conflicts"]:
        d.add_paragraph(cf["description"], style="List Bullet")
    for s in d.sections:
        s.footer.paragraphs[0].text = case["footer"] or ""
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# ------------------------------------------------------------------ PDF
def build_pdf(case_id: int) -> bytes:
    g = gather(case_id)
    case, st = g["case"], g["stats"]
    ss = getSampleStyleSheet()
    cover_big = ParagraphStyle("cb", parent=ss["Title"], fontSize=26, leading=32)
    small = ParagraphStyle("sm", parent=ss["Normal"], fontSize=8, leading=10)
    center = ParagraphStyle("ce", parent=ss["Normal"], alignment=1, fontSize=12, leading=18)

    def P(t, s=small):
        return Paragraph(escape(str(t or "")), s)

    story = [Spacer(1, 1.2 * inch), Paragraph(escape(case["firm_name"] or ""), ParagraphStyle("f", parent=center, fontSize=16)),
             Spacer(1, 1 * inch), Paragraph(escape(case["report_title"] or "Medical Chronology"), cover_big), Spacer(1, 0.3 * inch),
             Paragraph(escape(f"Case: {case['name']}"), center), Paragraph(escape(f"Claimant: {case['claimant'] or '-'}"), center),
             Paragraph(escape(f"Matter type: {case['matter_type'] or '-'}"), center),
             Paragraph(f"Prepared: {g['prepared']}", center)]
    if g["draft"]:
        story += [Spacer(1, 0.4 * inch), Paragraph("<b>Draft — pending expert sign-off</b>",
                                                   ParagraphStyle("d", parent=center, textColor=colors.HexColor("#b03030")))]
    story += [PageBreak(), Paragraph("Summary", ss["Heading1"])]
    grid = TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8eef7")),
                       ("VALIGN", (0, 0), (-1, -1), "TOP")])
    t = Table([[P(k, ss["Normal"]), P(v, ss["Normal"])] for k, v in _stat_lines(st)], colWidths=[3 * inch, 2 * inch])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey)]))
    story += [t, Spacer(1, 0.3 * inch), Paragraph("Paginated record index", ss["Heading1"])]
    rows = [[P("Bates range"), P("Document type"), P("Facility"), P("Date")]]
    for d in g["documents"]:
        rows.append([P(f"{d['bates_start']} - {d['bates_end']}"), P(d["doc_type"]), P(d["facility"]), P(d["service_date"] or "undated")])
    t = Table(rows, colWidths=[1.6 * inch, 1.6 * inch, 2.6 * inch, 1 * inch], repeatRows=1)
    t.setStyle(grid)
    story += [t, PageBreak(), Paragraph("Chronology", ss["Heading1"])]
    rows = [[P("Date"), P("Category"), P("Facility / provider"), P("Summary"), P("Sig."), P("Citations")]]
    for e in g["events"]:
        rows.append([P(_ev_label(e)), P(e["category"]), P(" / ".join(x for x in (e["facility"], e["provider"]) if x)),
                     P(e["summary"] + ("  [verified]" if e["verified"] else "")), P(e["significance"]), P(_cite(e))])
    if len(rows) == 1:
        rows.append([P("-")] * 6)
    t = Table(rows, colWidths=[0.9 * inch, 0.7 * inch, 1.3 * inch, 2.7 * inch, 0.5 * inch, 0.9 * inch], repeatRows=1)
    t.setStyle(grid)
    story += [t, Spacer(1, 0.3 * inch), Paragraph("Unresolved conflicts", ss["Heading1"])]
    if not g["conflicts"]:
        story.append(Paragraph("None.", ss["Normal"]))
    for cf in g["conflicts"]:
        story.append(Paragraph("• " + escape(cf["description"]), ss["Normal"]))
    footer = case["footer"] or ""

    def on_page(canv, doc):
        canv.saveState()
        canv.setFont("Helvetica", 8)
        canv.setFillColor(colors.grey)
        canv.drawString(0.75 * inch, 0.45 * inch, footer)
        canv.drawRightString(letter[0] - 0.75 * inch, 0.45 * inch, f"Page {doc.page}")
        canv.restoreState()

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.75 * inch,
                      bottomMargin=0.8 * inch, title=case["report_title"] or "Report").build(story, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
