"""Engagement-letter rendering: Jinja2 Markdown template -> .md and .docx (python-docx)."""
import re
from pathlib import Path

from docx import Document
from jinja2 import Environment, FileSystemLoader

from . import db

_env = Environment(loader=FileSystemLoader(str(db.HERE / "templates")), keep_trailing_newline=True)


def render_letter_md(firm: dict, client: dict, matter: dict, terms: dict) -> str:
    return _env.get_template("letter.md.j2").render(
        firm=firm, client=client, matter=matter, terms=terms,
        date=db.today().strftime("%B %d, %Y"), net_days=db.invoice_net_days(),
    )


def _add_runs(par, text: str) -> None:
    for i, chunk in enumerate(re.split(r"\*\*(.+?)\*\*", text)):
        if not chunk:
            continue
        chunk = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"\1", chunk)
        par.add_run(chunk).bold = bool(i % 2)


def md_to_docx(markdown_text: str, path: Path) -> None:
    doc = Document()
    for line in markdown_text.splitlines():
        s = line.rstrip()
        if not s:
            continue
        if s.startswith("# "):
            doc.add_heading(s[2:], level=0)
        elif s.startswith("## "):
            doc.add_heading(s[3:], level=2)
        elif s.startswith(("- ", "* ")):
            _add_runs(doc.add_paragraph(style="List Bullet"), s[2:])
        else:
            _add_runs(doc.add_paragraph(), s)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(path))


def save_letter(matter_id: int, markdown_text: str) -> str:
    """Write data/letters/<matter_id>.md and .docx; return the docx path."""
    d = db.letters_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{matter_id}.md").write_text(markdown_text, encoding="utf-8")
    md_to_docx(markdown_text, d / f"{matter_id}.docx")
    return str(d / f"{matter_id}.docx")
