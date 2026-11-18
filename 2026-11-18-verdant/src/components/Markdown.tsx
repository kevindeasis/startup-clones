import type { ReactNode } from "react";

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p,
  );
}

/** Tiny Markdown renderer: headings, bullet/numbered lists, tables, paragraphs. */
export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    const h = /^(#{1,3}) (.*)/.exec(l);
    if (h) {
      const Tag = `h${h[1].length}` as "h1" | "h2" | "h3";
      out.push(<Tag key={i}>{inline(h[2])}</Tag>);
    } else if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s-|]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(
        <div className="table-wrap" key={i}>
          <table>
            <thead><tr>{rows[0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (/^(- |\d+\. )/.test(l)) {
      const items: string[] = [];
      const ordered = /^\d+\. /.test(l);
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      i--;
      const L = ordered ? "ol" : "ul";
      out.push(<L key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
    } else out.push(<p key={i}>{inline(l)}</p>);
  }
  return <div className="md">{out}</div>;
}
