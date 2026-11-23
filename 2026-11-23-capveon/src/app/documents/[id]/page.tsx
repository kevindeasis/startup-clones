import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgency, getDocument, listDocuments, listSignals } from "@/lib/data";
import { fitBand } from "@/lib/fit";
import { readCollection } from "@/lib/store";
import type { Pursuit } from "@/lib/types";
import { AskBox } from "../../components/AskBox";
import { ReextractButton } from "../../components/ReextractButton";
import { TrackButton } from "../../components/TrackButton";
import { Chip, Fit } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) notFound();
  const pageNo = Math.min(Math.max(Number((await searchParams).page) || 1, 1), doc.pages.length);
  const page = doc.pages[pageNo - 1];
  const [agency, allSignals, allDocs, pursuits] = await Promise.all([getAgency(doc.agencyId), listSignals(), listDocuments(), readCollection<Pursuit>("pursuits")]);
  const signals = allSignals.filter((s) => s.sources.some((x) => x.documentId === id));
  const addenda = allDocs.filter((d) => d.parentDocumentId === id);
  const parent = doc.parentDocumentId ? allDocs.find((d) => d.id === doc.parentDocumentId) : undefined;
  const pursuit = pursuits.find((p) => p.documentId === id);
  const kf = doc.keyFields;
  const keyRows: [string, { value: string; page: number } | undefined][] = [
    ["Bid due", kf?.bidDue],
    ["Pre-bid meeting", kf?.preBid],
    ["Questions deadline", kf?.questionsDeadline],
    ["Bid bond", kf?.bidBond],
    ["Engineer's estimate", kf?.engineersEstimate],
  ];
  return (
    <>
      <div className="row">
        <div>
          <h1>{doc.title}</h1>
          <p className="sub">
            <Link href={`/agencies/${doc.agencyId}`}>{agency?.name}</Link> &middot; {doc.kind} &middot; {doc.date} &middot; {doc.pages.length} pages &middot; status: {doc.status}
            {doc.error ? <span className="err"> ({doc.error})</span> : null}
          </p>
          {parent && <p className="sub">Addendum to <Link href={`/documents/${parent.id}`}>{parent.title}</Link></p>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {doc.kind === "solicitation" && <TrackButton documentId={doc.id} pursuitId={pursuit?.id} label="Start pursuit" />}
          <ReextractButton documentId={doc.id} />
        </div>
      </div>

      {doc.kind === "solicitation" && (
        <>
          <h2>Bid review</h2>
          <div className="card">
            <dl className="kv">
              {keyRows.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k}</dt>
                  <dd>{v ? <>{v.value} <Link href={`/documents/${doc.id}?page=${v.page}`}>[p.{v.page}]</Link></> : <span className="muted">not found</span>}</dd>
                </div>
              ))}
            </dl>
          </div>
          <AskBox documentId={doc.id} />
          <h3>Requirements checklist</h3>
          <table>
            <thead><tr><th>Requirement</th><th>Kind</th><th>Page</th><th>Meets profile</th><th>Note</th></tr></thead>
            <tbody>
              {(doc.requirements ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.text}</td>
                  <td><Chip>{r.kind}</Chip></td>
                  <td><Link href={`/documents/${r.documentId ?? doc.id}?page=${r.page}`}>p.{r.page}</Link>{r.documentId && r.documentId !== doc.id ? " (addendum)" : ""}</td>
                  <td className={r.meetsProfile}>{r.meetsProfile}</td>
                  <td className="muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {addenda.length > 0 && (
            <>
              <h3>Addenda</h3>
              {addenda.map((a) => (
                <div className="card" key={a.id}>
                  <Link href={`/documents/${a.id}`}>{a.title}</Link> <span className="muted">({a.date})</span>
                  <ul>{(a.changes ?? []).map((c, i) => <li key={i}><Chip>{c.field}</Chip> {c.summary} <span className="muted">p.{c.page}</span></li>)}</ul>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {doc.kind === "addendum" && (
        <>
          <h2>Changes</h2>
          <table>
            <thead><tr><th>Field</th><th>Before</th><th>After</th><th>Summary</th><th>Page</th></tr></thead>
            <tbody>
              {(doc.changes ?? []).map((c, i) => (
                <tr key={i}><td><Chip>{c.field}</Chip></td><td>{c.before ?? "-"}</td><td>{c.after ?? "-"}</td><td>{c.summary}</td><td>p.{c.page}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Signals ({signals.length})</h2>
      {signals.map((s) => (
        <div className="card" key={s.id}>
          <div className="row"><div><strong>{s.projectTitle}</strong><div className="chips"><Chip>{s.category}</Chip><Chip>{s.stage}</Chip></div><div className="muted">{s.fitRationale}</div></div><Fit score={s.fitScore} band={fitBand(s.fitScore)} /></div>
        </div>
      ))}
      {signals.length === 0 && <p className="muted">No signals extracted from this document.</p>}

      <h2>Pages</h2>
      <div className="pager">
        {doc.pages.map((p) => <Link key={p.n} className={p.n === pageNo ? "on" : ""} href={`/documents/${doc.id}?page=${p.n}`}>{p.n}</Link>)}
      </div>
      <div className="page-text" id="page">{page?.text}</div>
    </>
  );
}
