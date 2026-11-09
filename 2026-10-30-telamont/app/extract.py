"""Text extraction (pypdf / plain text) and page-bounded chunking."""
import io
import re
from typing import List, Tuple

from pypdf import PdfReader

MIN_CHUNK = 1200
MAX_CHUNK = 1800
TEXT_EXTS = {".txt", ".md", ".markdown"}
SUPPORTED_EXTS = TEXT_EXTS | {".pdf"}


class ExtractionError(Exception):
    pass


def guess_kind(filename: str) -> str:
    n = filename.lower()
    if any(k in n for k in ("contract", "agreement", "subcontract", "addend")):
        return "contract"
    if any(k in n for k in ("spec", "div", "section")):
        return "spec"
    if any(k in n for k in ("drawing", "sheet", "notes", "plan")) or re.search(r"(^|[_\-\s])[a-z]-\d{3}", n):
        return "drawing"
    if any(k in n for k in ("schedule", "gantt", "milestone")):
        return "schedule"
    return "other"


def extract_pages(data: bytes, filename: str) -> List[str]:
    """Return one text string per page. Raises ExtractionError with a clear message."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            pages = [(p.extract_text() or "").strip() for p in reader.pages]
        except Exception as e:
            raise ExtractionError(f"Could not read PDF: {e}") from e
        if not any(pages):
            raise ExtractionError(
                "No extractable text found (scanned/image-only PDF). OCR is not supported."
            )
        return pages
    if ext in TEXT_EXTS:
        text = data.decode("utf-8", errors="replace").strip()
        if not text:
            raise ExtractionError("File is empty.")
        return [p.strip() for p in text.split("\f")]
    raise ExtractionError(f"Unsupported file type '{ext}'. Use PDF, TXT or MD.")


def _split_long(par: str) -> List[str]:
    if len(par) <= MAX_CHUNK:
        return [par]
    sentences = re.split(r"(?<=[.;!?])\s+", par)
    out, cur = [], ""
    for s in sentences:
        while len(s) > MAX_CHUNK:  # pathological: no punctuation
            if cur:
                out.append(cur)
                cur = ""
            out.append(s[:MAX_CHUNK])
            s = s[MAX_CHUNK:]
        if cur and len(cur) + len(s) + 1 > MAX_CHUNK:
            out.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        out.append(cur)
    return out


def chunk_page(text: str) -> List[str]:
    """Split a single page on paragraph boundaries into ~1200-1800 char chunks."""
    text = text.strip()
    if not text:
        return []
    pars = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(pars) == 1 and "\n" in pars[0]:  # PDFs often only have single newlines
        pars = [p.strip() for p in pars[0].split("\n") if p.strip()]
    pieces: List[str] = []
    for p in pars:
        pieces.extend(_split_long(p))
    chunks, cur = [], ""
    for p in pieces:
        if not cur:
            cur = p
        elif len(cur) < MIN_CHUNK and len(cur) + len(p) + 1 <= MAX_CHUNK:
            cur = f"{cur}\n{p}"
        else:
            chunks.append(cur)
            cur = p
    if cur:
        chunks.append(cur)
    return chunks


def chunk_pages(pages: List[str]) -> List[Tuple[int, int, str]]:
    """Return (page_number, idx, text); chunks never span pages. idx is doc-global."""
    out, idx = [], 0
    for pno, text in enumerate(pages, start=1):
        for c in chunk_page(text):
            out.append((pno, idx, c))
            idx += 1
    return out
