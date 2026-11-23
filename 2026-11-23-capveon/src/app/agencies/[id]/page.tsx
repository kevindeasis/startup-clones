import Link from "next/link";
import { notFound } from "next/navigation";
import { agencyDetail } from "@/lib/agencies";
import { fitBand } from "@/lib/fit";
import { Chip, Fit, money } from "../../components/ui";

export const dynamic = "force-dynamic";

function Bars({ data }: { data: { fy: number; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const w = 70;
  return (
    <svg className="bars" role="img" aria-label="Spend by fiscal year" viewBox={`0 0 ${data.length * w + 10} 150`} width="100%" style={{ maxWidth: 480 }}>
      {data.map((d, i) => {
        const h = Math.round((d.total / max) * 100);
        return (
          <g key={d.fy} transform={`translate(${10 + i * w},0)`}>
            <rect x={0} y={115 - h} width={w - 16} height={h} rx={3} />
            <text x={(w - 16) / 2} y={110 - h} textAnchor="middle">{money(d.total)}</text>
            <text x={(w - 16) / 2} y={133} textAnchor="middle">FY{d.fy}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function AgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const d = await agencyDetail((await params).id);
  if (!d) notFound();
  const { agency, spend } = d;
  return (
    <>
      <h1>{agency.name}</h1>
      <p className="sub">{agency.type} &middot; {agency.region}{agency.population ? ` · population ${agency.population.toLocaleString("en-US")}` : ""}</p>
      <h2>Spend &mdash; {money(spend.total)} total</h2>
      <div className="grid2">
        <div className="card"><Bars data={spend.byFiscalYear} /><div className="muted" style={{ fontSize: 12 }}>Fiscal year = calendar year of award date.</div></div>
        <div className="card">
          <strong>Top vendors</strong>
          <table><tbody>{spend.topVendors.map((v) => <tr key={v.vendor}><td>{v.vendor}</td><td>{v.count} awards</td><td>{money(v.total)}</td></tr>)}</tbody></table>
          <strong>By category</strong>
          <table><tbody>{spend.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td>{money(c.total)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <h2>Contacts</h2>
      <table>
        <thead><tr><th>Name</th><th>Title</th><th>Role</th><th>Email</th></tr></thead>
        <tbody>{d.contacts.map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.title}</td><td><Chip>{c.role}</Chip></td><td>{c.email ?? "-"}</td></tr>)}</tbody>
      </table>
      <h2>Documents</h2>
      <table>
        <tbody>{d.documents.map((x) => <tr key={x.id}><td><Link href={`/documents/${x.id}`}>{x.title}</Link></td><td>{x.kind}</td><td>{x.date}</td></tr>)}</tbody>
      </table>
      <h2>Signals</h2>
      {d.signals.map((s) => (
        <div className="card" key={s.id}><div className="row"><div><strong>{s.projectTitle}</strong><div className="chips"><Chip>{s.category}</Chip><Chip>{s.stage}</Chip></div></div><Fit score={s.fitScore} band={fitBand(s.fitScore)} /></div></div>
      ))}
      <h2>Recent awards</h2>
      <table>
        <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>{d.awards.slice(0, 12).map((a) => <tr key={a.id}><td>{a.date}</td><td>{a.vendor}</td><td>{a.category}</td><td>{a.description}</td><td>{money(a.amount)}</td></tr>)}</tbody>
      </table>
    </>
  );
}
