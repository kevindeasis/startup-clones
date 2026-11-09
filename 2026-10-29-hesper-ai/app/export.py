"""Evidence file exports: Markdown, PDF (fpdf2), JSON."""
from __future__ import annotations

import json

from fpdf import FPDF


def _n(r: dict, doc_id: str) -> str:
    return r.get("document_names", {}).get(doc_id, doc_id)


def to_json(r: dict) -> str:
    return json.dumps(r, indent=2, default=str)


def to_markdown(r: dict) -> str:
    c, risk, cov = r["claim"], r["risk"], r["coverage"]
    L = [f"# Evidence File - Claim {c['claim_number']}", "",
         f"- Claimant: {c['claimant_name']}", f"- Line of business: {c['line_of_business']}",
         f"- Loss date: {c['loss_date']}", f"- Description: {c['description']}",
         f"- Generated: {r['generated_at']} (provider: {r.get('provider')})", "",
         "## Executive summary", "", r["executive_summary"], "",
         f"## Risk score: {risk['score']}/100 ({risk['band']})", ""]
    L += [f"- {x}" for x in risk["rationale"]]
    L += ["", "## Timeline", "", "| Date | Event | Source | Quote |", "|---|---|---|---|"]
    for e in r["timeline"]["events"]:
        L.append(f"| {e['date']} | {e['event'].replace('|', '/')} | {_n(r, e['document_id'])} | \"{e['quote'].replace('|', '/')}\" |")
    if r["timeline"]["gaps_or_anomalies"]:
        L += ["", "**Anomalies:**"] + [f"- {a}" for a in r["timeline"]["gaps_or_anomalies"]]
    L += ["", "## Statement analysis - inconsistencies", ""]
    if not r["inconsistencies"]:
        L.append("No inconsistencies identified.")
    for i in r["inconsistencies"]:
        L += [f"### {i['title']} ({i['severity']})", "",
              f"- A [{_n(r, i['claim_a']['document_id'])}]: \"{i['claim_a']['quote']}\"",
              f"- B [{_n(r, i['claim_b']['document_id'])}]: \"{i['claim_b']['quote']}\"",
              f"- {i['explanation']}", ""]
    if r["corroborations"]:
        L += ["**Corroborated facts:**"] + [f"- {x['fact']} ({', '.join(_n(r, d) for d in x['document_ids'])})" for x in r["corroborations"]] + [""]
    L += ["## Assertions by document", ""]
    for s in r["statement_analysis"]:
        L.append(f"### {s['filename']} ({s['doc_type']})")
        L.append(s["facts"]["summary"])
        for a in s["facts"]["assertions"]:
            L.append(f"- {a['speaker'] or 'unknown'}: \"{a['quote']}\"")
        L.append("")
    L += [f"## Coverage position: {cov['position']}", "", cov["rationale"], ""]
    for cl in cov["clauses"]:
        L.append(f"- [{cl['effect']}] \"{cl['clause_quote']}\" ({_n(r, cl['document_id'])})")
    L += [f"- Open question: {q}" for q in cov["open_questions"]]
    L += ["", "## Document forensics", ""]
    flags = [f for f in r["forensics"]]
    if not flags:
        L.append("No flags.")
    for f in flags:
        L.append(f"- [{f['severity']}] {_n(r, f['document_id'])}: {f['flag']} - {f['detail']}")
    L += ["", "## Recommended next actions", ""]
    for a in r["recommended_actions"]:
        L.append(f"- **{a['priority'].upper()}**: {a['action']} - {a['why']}")
    L += ["", "## Decision log", "", "| # | Step | Model | In tokens | Out tokens | ms | Time |", "|---|---|---|---|---|---|---|"]
    for d in r["decision_log"]:
        L.append(f"| {d['id']} | {d['step']} | {d['model']} | {d['input_tokens']} | {d['output_tokens']} | {d['duration_ms']} | {d['created_at']} |")
    L += ["", "_Independent educational clone; not affiliated with Hesper AI. AI-generated; verify against source documents._", ""]
    return "\n".join(L)


def _lat(s) -> str:
    s = str(s).replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return s.encode("latin-1", "replace").decode("latin-1")


def to_pdf(r: dict) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()
    W = pdf.epw

    def h(text, size=13):
        pdf.ln(3)
        pdf.set_font("Helvetica", "B", size)
        pdf.multi_cell(W, 7, _lat(text), new_x="LMARGIN", new_y="NEXT")

    def p(text, size=9, style=""):
        pdf.set_font("Helvetica", style, size)
        pdf.multi_cell(W, 5, _lat(text), new_x="LMARGIN", new_y="NEXT")

    c, risk, cov = r["claim"], r["risk"], r["coverage"]
    h(f"Evidence File - Claim {c['claim_number']}", 16)
    p(f"Claimant: {c['claimant_name']} | LOB: {c['line_of_business']} | Loss date: {c['loss_date']}")
    p(f"Description: {c['description']}")
    p(f"Generated {r['generated_at']} (provider: {r.get('provider')})")
    h("Executive summary")
    p(r["executive_summary"], 10)
    h(f"Risk score: {risk['score']}/100 ({risk['band']})")
    for x in risk["rationale"]:
        p(f"- {x}")
    h("Timeline")
    for e in r["timeline"]["events"]:
        p(f"{e['date']}  {e['event']}", 9, "B")
        p(f'   Source: {_n(r, e["document_id"])} - "{e["quote"]}"')
    for a in r["timeline"]["gaps_or_anomalies"]:
        p(f"Anomaly: {a}", 9, "I")
    h("Inconsistencies")
    if not r["inconsistencies"]:
        p("None identified.")
    for i in r["inconsistencies"]:
        p(f"{i['title']} [{i['severity']}]", 10, "B")
        p(f'A ({_n(r, i["claim_a"]["document_id"])}): "{i["claim_a"]["quote"]}"')
        p(f'B ({_n(r, i["claim_b"]["document_id"])}): "{i["claim_b"]["quote"]}"')
        p(i["explanation"], 9, "I")
        pdf.ln(1)
    h(f"Coverage position: {cov['position']}")
    p(cov["rationale"], 10)
    for cl in cov["clauses"]:
        p(f'- [{cl["effect"]}] "{cl["clause_quote"]}" ({_n(r, cl["document_id"])})')
    for qn in cov["open_questions"]:
        p(f"- Open question: {qn}")
    h("Document forensics")
    if not r["forensics"]:
        p("No flags.")
    for f in r["forensics"]:
        p(f"- [{f['severity']}] {_n(r, f['document_id'])}: {f['flag']} - {f['detail']}")
    h("Recommended next actions")
    for a in r["recommended_actions"]:
        p(f"- {a['priority'].upper()}: {a['action']} ({a['why']})")
    h("Decision log")
    for d in r["decision_log"]:
        p(f"#{d['id']} {d['step']} | {d['model']} | in={d['input_tokens']} out={d['output_tokens']} | {d['duration_ms']}ms | {d['created_at']}")
    pdf.ln(4)
    p("Independent educational clone; not affiliated with Hesper AI. AI-generated; verify against source documents.", 8, "I")
    return bytes(pdf.output())
