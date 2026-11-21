import Link from "next/link";
import { notFound } from "next/navigation";
import { store } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ docId: string }> }) {
  const doc = await store.getDocument((await params).docId);
  if (!doc) notFound();
  return (
    <>
      <div>
        <h1>{doc.title}</h1>
        <p className="muted">
          {doc.type}, {doc.pageCount} page(s), {doc.chunks.length} chunks, ingested in {doc.mode} mode.{" "}
          <Link href={`/obligors/${doc.obligorId}`}>Back to obligor</Link>
        </p>
      </div>
      {doc.pages.map((p, i) => (
        <section key={i} id={`p-${i + 1}`} className="panel stack">
          <h2>Page {i + 1}</h2>
          <div className="doc-page">{p}</div>
        </section>
      ))}
    </>
  );
}
