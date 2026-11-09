"""Generate the three sample construction PDFs (Maple Street Community Center)."""
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

OUT = Path(__file__).resolve().parent.parent / "sample_docs"

DOCS = {
    "01_prime_contract.pdf": [
        [
            ("h", "Maple Street Community Center - Prime Contract (Excerpt)"),
            ("h2", "Article 3 - Time"),
            ("p", "3.1 The Contractor shall achieve Substantial Completion within 180 calendar days from the Notice to Proceed."),
            ("p", "3.2 Time is of the essence for all obligations under this Contract."),
            ("p", "3.3 If the Contractor is delayed, the Contractor shall give written notice of delay within 7 days of the first occurrence of the delay event; failure to do so waives the claim for additional time."),
            ("h2", "Article 4 - Liquidated Damages"),
            ("p", "4.1 Liquidated damages of $1,500 per calendar day shall be assessed for each day Substantial Completion is delayed beyond the date required by Section 3.1."),
        ],
        [
            ("h2", "Article 5 - Payment"),
            ("p", "5.1 The Owner shall retain retainage of 10% of each progress payment until Substantial Completion."),
            ("p", "5.2 The Contractor shall pay each Subcontractor only when paid by the Owner, on a pay-when-paid basis, and the Contractor's obligation to pay is conditioned on receipt of payment from the Owner."),
            ("h2", "Article 6 - Warranty"),
            ("p", "6.1 The Contractor warrants all Work for a warranty period of 1 year from the date of Substantial Completion."),
            ("h2", "Article 7 - Order of Precedence"),
            ("p", "7.1 In the event of conflict among the Contract Documents, the order of precedence shall be: first the Contract, then the Specifications, then the Drawings."),
        ],
    ],
    "02_specifications_div03.pdf": [
        [
            ("h", "Division 03 - Concrete (Specification Excerpt)"),
            ("h2", "Section 03 30 00 - Cast-in-Place Concrete"),
            ("p", "2.1 Footings and foundation walls shall have a minimum compressive strength of 4,000 psi at 28 days."),
            ("p", "2.2 Interior slabs on grade shall have a minimum compressive strength of 3,500 psi at 28 days."),
            ("p", "2.3 Exterior concrete exposed to freezing shall contain air entrainment of 6 percent, plus or minus 1.5 percent."),
        ],
        [
            ("h2", "Part 1 - Submittals and Warranty"),
            ("p", "1.4 Submit mix designs and product data for review within 14 days after the Notice to Proceed."),
            ("p", "1.5 The Contractor shall provide a warranty period of 2 years on structural concrete, from the date of Substantial Completion."),
            ("p", "1.6 Written notice of nonconforming concrete shall be given within 14 days of discovery."),
        ],
    ],
    "03_drawing_notes_S-001.pdf": [
        [
            ("h", "Sheet S-001 - Structural General Notes"),
            ("p", "1. All concrete shall be 3,000 psi at 28 days unless noted otherwise on the drawings."),
            ("p", "2. Reinforcing steel shall be ASTM A615 Grade 60 deformed bars."),
            ("p", "3. Concrete work shall conform to Specification Section 03 30 00 Revision C."),
            ("h2", "Project Schedule Milestones"),
            ("p", "4. Milestone: Substantial Completion at 210 calendar days after Notice to Proceed."),
        ],
    ],
}


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ss = getSampleStyleSheet()
    styles = {"h": ss["Title"], "h2": ss["Heading3"], "p": ss["BodyText"]}
    for name, pages in DOCS.items():
        doc = SimpleDocTemplate(str(OUT / name), pagesize=letter, title=name)
        story = []
        for i, page in enumerate(pages):
            if i:
                story.append(PageBreak())
            for kind, text in page:
                story.append(Paragraph(escape(text), styles[kind]))
                story.append(Spacer(1, 8))
        doc.build(story)
        print("wrote", OUT / name)


if __name__ == "__main__":
    build()
