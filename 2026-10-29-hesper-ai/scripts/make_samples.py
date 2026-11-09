"""Generate sample_data/ files for the demo claim (run: python scripts/make_samples.py)."""
from datetime import datetime, timezone
from pathlib import Path

import pymupdf as fitz
from fpdf import FPDF

OUT = Path(__file__).resolve().parent.parent / "sample_data"
OUT.mkdir(exist_ok=True)

POLICY = """HOMEOWNERS POLICY - EXCERPT
Policy Number: HO-5521904
Named Insured: Dana Whitfield
Policy Period: 2026-01-01 to 2026-12-31
Insured Location: 48 Alder Lane, Portland, OR

SECTION I - PERILS INSURED AGAINST
We cover direct physical loss to the dwelling caused by sudden and accidental discharge of water from a plumbing system.

SECTION I - EXCLUSIONS
We do not cover loss caused by continuous or repeated seepage or leakage of water over a period of 14 days or more.
We do not cover loss caused by flood, surface water, or groundwater seepage, including water that enters through foundation walls or floors.
We do not cover loss resulting from wear and tear, rust, or corrosion.

CONDITIONS
Duties after loss: you must give prompt notice and protect the property from further damage.
Limit: Dwelling coverage limit is $350,000 with a $2,500 deductible.
"""

STATEMENT = """RECORDED STATEMENT OF DANA WHITFIELD
Taken by: Marcus Bell, Claims Adjuster
Statement date: 2026-03-18

Q: Please describe what happened.
A: On the night of March 9, 2026, I came downstairs and noticed water coming up through the basement floor after three days of heavy rain.
A: I believe the water was seeping through the foundation wall, and I saw damp patches there for several weeks before.
A: The water softened the drywall and ruined the carpet and a sofa.
A: I did not have a plumber look at any pipe, and I did not see a burst pipe.
A: I called a restoration company the next morning to start drying the basement.
"""

FNOL = [
    "FIRST NOTICE OF LOSS",
    "Claim Number: CLM-2026-0457",
    "Policy Number: HO-5521904",
    "Insured: Dana Whitfield",
    "Date of Loss: 2026-03-14",
    "Date Reported: 2026-03-15",
    "Reported by: Dana Whitfield (insured)",
    "Loss Location: 48 Alder Lane, Portland, OR",
    "Cause of Loss: Sudden burst pipe in the basement utility room.",
    "Description: A supply pipe burst on the evening of the loss and flooded the finished basement.",
    "Estimated damage: $6,500.00",
    "Police report filed: No",
]

INVOICE = [
    "SUMMIT RESTORATION SERVICES",
    "INVOICE",
    "Invoice No: SR-20931",
    "Invoice Date: 2026-03-02",
    "Customer: Dana Whitfield",
    "Property: 48 Alder Lane, Portland, OR",
    "Description of work: Emergency water extraction and structural drying of finished basement.",
    "Water extraction and drying: $9,800.00",
    "Drywall and carpet removal: $4,650.00",
    "Contents pack-out: $4,000.00",
    "Total amount due: $18,450.00",
]


def make_pdf(path: Path, lines: list[str], creator: str, created: datetime) -> None:
    pdf = FPDF()
    pdf.add_page()
    pdf.set_creator(creator)
    pdf.set_creation_date(created)
    pdf.set_title(lines[0])
    for i, line in enumerate(lines):
        pdf.set_font("Helvetica", "B" if i < 2 else "", 14 if i < 2 else 11)
        pdf.multi_cell(0, 7, line, new_x="LMARGIN", new_y="NEXT")
    pdf.output(str(path))


(OUT / "policy.txt").write_text(POLICY)
(OUT / "statement.txt").write_text(STATEMENT)
make_pdf(OUT / "fnol.pdf", FNOL, "Claimsleuth sample generator", datetime(2026, 3, 15, 9, 0, tzinfo=timezone.utc))
inv = OUT / "invoice.pdf"
make_pdf(inv, INVOICE, "Microsoft Word", datetime(2026, 3, 2, 10, 0, tzinfo=timezone.utc))
# Incremental save with PyMuPDF so the file ends up with two %%EOF markers (forensics demo).
doc = fitz.open(str(inv))
doc.set_metadata({**doc.metadata, "producer": "iLovePDF"})
doc.saveIncr()
doc.close()
n = inv.read_bytes().count(b"%%EOF")
assert n == 2, f"expected 2 %%EOF markers, got {n}"
print("wrote", [p.name for p in sorted(OUT.iterdir())], "invoice %%EOF count:", n)
