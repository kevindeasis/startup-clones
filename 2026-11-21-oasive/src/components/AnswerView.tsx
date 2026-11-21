"use client";
import Link from "next/link";
import { Fragment, useState } from "react";

export type AnswerCitationView = { n: number; docId: string; docTitle: string; page: number; quote: string };

/** Renders an answer with clickable [n] citation chips that reveal the quoted chunk. */
export function AnswerView({ answer, citations }: { answer: string; citations: AnswerCitationView[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts = answer.split(/(\[\d+\])/g);
  const active = open != null ? byN.get(open) : undefined;
  return (
    <div className="answer">
      <p>
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d+)\]$/);
          if (!m) return <Fragment key={i}>{p}</Fragment>;
          const n = Number(m[1]);
          return byN.has(n) ? (
            <button
              key={i}
              type="button"
              className={`chip${open === n ? " on" : ""}`}
              onClick={() => setOpen(open === n ? null : n)}
              aria-label={`Citation ${n}`}
            >
              {n}
            </button>
          ) : (
            <Fragment key={i}>{p}</Fragment>
          );
        })}
      </p>
      {active && (
        <div className="quote-box" data-testid="quote-box">
          <strong>{active.docTitle}</strong>, page {active.page}
          <blockquote>{active.quote}</blockquote>
          <Link href={`/documents/${active.docId}#p-${active.page}`}>Open page</Link>
        </div>
      )}
      {citations.length > 0 && (
        <ul className="cite-list">
          {citations.map((c) => (
            <li key={c.n}>
              <span className="chip static">{c.n}</span> {c.docTitle}, p. {c.page}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
