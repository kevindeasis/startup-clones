"""Parse uploaded files into (label, text) sections, chunk them, store in SQLite."""
import io
import re

from . import db

CHUNK_SIZE = 800
OVERLAP = 100


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = OVERLAP) -> list[str]:
    text = re.sub(r"[ \t]+", " ", text).strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    out, start, n = [], 0, len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            # prefer to break on sentence/space boundary in the last 20% of the window
            window = text[start:end]
            cut = max(window.rfind(". "), window.rfind("\n"))
            if cut < size * 0.6:
                cut = window.rfind(" ")
            if cut >= size * 0.6:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return out


def _split_markdown(text: str) -> list[tuple[str, str]]:
    sections, label, buf = [], "Section 1", []
    for line in text.splitlines():
        m = re.match(r"^#{1,6}\s+(.*)", line)
        if m:
            if "".join(buf).strip():
                sections.append((label, "\n".join(buf)))
            label, buf = m.group(1).strip(), []
        else:
            buf.append(line)
    if "".join(buf).strip():
        sections.append((label, "\n".join(buf)))
    return sections or [("Section 1", text)]


def parse_file(filename: str, data: bytes) -> list[tuple[str, str]]:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else "txt"
    if ext == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return [(f"p.{i + 1}", p.extract_text() or "") for i, p in enumerate(reader.pages)]
    if ext == "docx":
        import docx
        d = docx.Document(io.BytesIO(data))
        sections, label, buf = [], "Section 1", []
        for p in d.paragraphs:
            if p.style is not None and p.style.name.lower().startswith("heading") and p.text.strip():
                if "".join(buf).strip():
                    sections.append((label, "\n".join(buf)))
                label, buf = p.text.strip(), []
            else:
                buf.append(p.text)
        if "".join(buf).strip():
            sections.append((label, "\n".join(buf)))
        return sections
    if ext == "xlsx":
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        out = []
        for ws in wb.worksheets:
            lines = [", ".join("" if v is None else str(v) for v in row) for row in ws.iter_rows(values_only=True)]
            out.append((f"Sheet {ws.title}", "\n".join(lines)))
        return out
    text = data.decode("utf-8", errors="replace")
    return _split_markdown(text) if ext == "md" else [("Section 1", text)]


def store_document(title: str, kind: str, public: bool, sections: list[tuple[str, str]]) -> dict:
    with db.connect() as c:
        cur = c.execute("INSERT INTO documents(title, kind, public, created_at) VALUES(?,?,?,?)",
                        (title, kind, 1 if public else 0, db.now()))
        doc_id, ordinal = cur.lastrowid, 0
        for label, text in sections:
            for piece in chunk_text(text):
                c.execute("INSERT INTO chunks(document_id, ordinal, label, text) VALUES(?,?,?,?)",
                          (doc_id, ordinal, label, piece))
                ordinal += 1
    return {"id": doc_id, "title": title, "kind": kind, "public": public, "chunks": ordinal}


def ingest_file(filename: str, data: bytes, kind: str = "other", public: bool = False, title: str | None = None) -> dict:
    sections = parse_file(filename, data)
    if not any(t.strip() for _, t in sections):
        raise ValueError("No extractable text found in file")
    return store_document(title or filename, kind, public, sections)
