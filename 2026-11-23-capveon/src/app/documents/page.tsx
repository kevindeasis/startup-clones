import Link from "next/link";
import { agencyMap, listDocuments, listSignals } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const [docs, agencies, signals] = await Promise.all([listDocuments(), agencyMap(), listSignals()]);
  const rows = [...docs].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className="row"><div><h1>Documents</h1><p className="sub">Meeting minutes, plans, budgets and solicitations (fictional).</p></div><Link className="btn" href="/documents/new">Add document</Link></div>
      <table>
        <thead><tr><th>Title</th><th>Agency</th><th>Kind</th><th>Date</th><th>Pages</th><th>Signals</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td><Link href={`/documents/${d.id}`}>{d.title}</Link></td>
              <td>{agencies.get(d.agencyId)?.name}</td>
              <td>{d.kind}</td>
              <td>{d.date}</td>
              <td>{d.pages.length}</td>
              <td>{signals.filter((s) => s.sources.some((x) => x.documentId === d.id)).length}</td>
              <td>{d.status}{d.error ? ` - ${d.error}` : ""}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">No documents. Run <code>npm run seed</code>.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
