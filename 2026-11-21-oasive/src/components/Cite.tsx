import Link from "next/link";
import type { Citation } from "@/lib/types";

/** Small "source" disclosure: document title + page + the quoted line (no JS needed). */
export function Cite({ c }: { c: Citation }) {
  return (
    <details className="cite">
      <summary title="Show source">{c.verified ? "source" : "⚠ source"}</summary>
      <div className="cite-body">
        <strong>{c.docTitle}</strong>, page {c.page}
        <blockquote>{c.quote}</blockquote>
        {!c.verified && <div className="warn">Quote could not be verified against the document text.</div>}
        <Link href={`/documents/${c.docId}#p-${c.page}`}>Open page</Link>
      </div>
    </details>
  );
}
