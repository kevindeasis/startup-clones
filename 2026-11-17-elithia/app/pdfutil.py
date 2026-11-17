"""PyMuPDF helpers: text extraction (paragraph-aware), blank detection, PNG rendering."""
import hashlib
import re
from pathlib import Path

import pymupdf

BLANK_TEXT_MAX = 20      # fewer visible characters than this ...
BLANK_INK_MAX = 0.005    # ... and less ink than this fraction of pixels => blank


def extract_paragraphs(page) -> list[str]:
    """Text of a page as paragraphs, split on vertical gaps between lines."""
    d = page.get_text("dict")
    lines = []
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for ln in b.get("lines", []):
            txt = "".join(s["text"] for s in ln.get("spans", [])).strip()
            if txt:
                x0, y0, x1, y1 = ln["bbox"]
                lines.append((y0, x0, y1 - y0, txt))
    lines.sort(key=lambda t: (round(t[0], 0), t[1]))
    paras, cur, prev = [], [], None
    for y0, x0, h, txt in lines:
        if prev is not None and (y0 - prev[0]) > 1.4 * max(prev[1], 1):
            paras.append(" ".join(cur))
            cur = []
        cur.append(txt)
        prev = (y0, h)
    if cur:
        paras.append(" ".join(cur))
    return paras


def extract_text(page) -> str:
    return "\n\n".join(extract_paragraphs(page))


def ink_ratio(page) -> float:
    pix = page.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), colorspace=pymupdf.csGRAY)
    samples = pix.samples
    if not samples:
        return 0.0
    dark = sum(1 for v in samples if v < 200)
    return dark / len(samples)


def is_blank(page, text: str) -> bool:
    visible = re.sub(r"\s+", "", text or "")
    if len(visible) >= BLANK_TEXT_MAX:
        return False
    return ink_ratio(page) < BLANK_INK_MAX


def norm_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(norm_text(text).encode()).hexdigest()


def render_png(pdf_path: str, page_index: int, out_path: Path, zoom: float = 1.5) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with pymupdf.open(pdf_path) as doc:
        pix = doc[page_index].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
        pix.save(str(out_path))
    return out_path
