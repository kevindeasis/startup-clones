import Link from "next/link";
import { notFound } from "next/navigation";
import { carriers, getCarrier } from "@/lib/data";
import { LINE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ carrierId: string }> }) {
  const { carrierId } = await params;
  const carrier = getCarrier(carrierId);
  if (!carrier) notFound();
  const a = carrier.appetite;
  return (
    <>
      <div className="tabs">
        {carriers.map((c) => (
          <Link key={c.id} href={`/portal/${c.id}`} className={c.id === carrier.id ? "tab active" : "tab"}>{c.name}</Link>
        ))}
      </div>
      <h1>{carrier.name} agent portal</h1>
      <p className="muted">{carrier.blurb} This is the (fictional) portal that BrokerDesk keys on the broker&apos;s behalf via <code>POST /api/carriers/{carrier.id}/quote</code>.</p>
      <h2>Lines written</h2>
      <p>{carrier.lines.map((l) => LINE_LABELS[l]).join(", ")} <span className="muted small">(typical turnaround {carrier.turnaroundMs} ms)</span></p>
      <h2>Submission fields</h2>
      <div className="tableWrap"><table>
        <thead><tr><th>Portal field</th><th>Type</th><th>Required</th><th>Maps from risk profile</th></tr></thead>
        <tbody>
          {Object.entries(carrier.fieldSchema).map(([name, f]) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td>{f.type}</td>
              <td>{f.required ? (f.forLines ? `yes (${f.forLines.join(", ")})` : "yes") : "no"}</td>
              <td><code>{f.path}</code></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Appetite</h2>
      <ul>
        <li>Industries declined: {a.industriesDeclined.length ? a.industriesDeclined.join(", ") : "none"}</li>
        <li>Max revenue: {a.maxRevenue ? `$${a.maxRevenue.toLocaleString("en-US")}` : "no limit"}</li>
        <li>States declined: {a.statesDeclined.length ? a.statesDeclined.join(", ") : "none"}</li>
        {a.declineWhen.map((r, i) => (<li key={i}>Declines {r.industry} when {r.requestedLine} is requested: {r.reason}</li>))}
      </ul>
      <h2>Rating table</h2>
      {Object.entries(carrier.rating.lines).map(([line, lr]) => (
        <div key={line} className="card static">
          <strong>{LINE_LABELS[line as keyof typeof LINE_LABELS]}</strong>
          <div className="small">Base rate ${lr.base.toLocaleString("en-US")} | deductible options {lr.deductibleOptions.map((d) => `$${d}`).join(", ")}</div>
          <div className="small">Limits: {Object.entries(lr.limits).map(([k, v]) => `${k} $${v.toLocaleString("en-US")}`).join(", ")}</div>
          <div className="small">Coverages: {lr.coverages.join("; ")}</div>
          <div className="small">Exclusions: {lr.exclusions.join("; ")}</div>
        </div>
      ))}
      <p className="small muted">Industry multipliers: {Object.entries(carrier.rating.industryMultipliers).map(([k, v]) => `${k} x${v}`).join(", ")}</p>
    </>
  );
}
