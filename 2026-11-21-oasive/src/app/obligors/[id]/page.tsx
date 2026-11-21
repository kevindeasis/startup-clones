import Link from "next/link";
import { notFound } from "next/navigation";
import { AskBox } from "@/components/AskBox";
import { SeverityBadge, TypeBadge } from "@/components/Badges";
import { Cite } from "@/components/Cite";
import { UploadForm } from "@/components/UploadForm";
import { fmtMetric, fmtUsd, SECTOR_LABEL } from "@/lib/format";
import { HttpError, obligorDetail, SECTOR_METRICS } from "@/lib/service";
import type { Metric } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ObligorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let o;
  try {
    o = await obligorDetail(id);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const years = Array.from(new Set(o.metrics.map((m) => m.fiscalYear))).sort();
  const names = Array.from(new Set(o.metrics.map((m) => m.name)));
  const cell = (name: string, y: number): Metric | undefined => o.metrics.find((m) => m.name === name && m.fiscalYear === y);
  const latest = (name: string): Metric | undefined =>
    o.metrics.filter((m) => m.name === name).sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const sectorNames = (SECTOR_METRICS[o.sector] ?? []).filter((n) => latest(n));

  return (
    <>
      <div className="panel stack">
        <div className="row wrap">
          <h1>{o.name}</h1>
          <span className="badge">{SECTOR_LABEL[o.sector] ?? o.sector}</span>
          <span className="badge">{o.state}</span>
          {o.rating && <span className="badge type">Rating {o.rating}</span>}
        </div>
        <div className="muted">{o.description}</div>
        <div>
          Outstanding debt: <strong>{o.outstandingDebtUsd != null ? fmtUsd(o.outstandingDebtUsd) : "n/a"}</strong>
        </div>
      </div>

      <section className="panel stack" aria-label="Sector metrics">
        <h2>Sector metrics</h2>
        {sectorNames.length === 0 ? (
          <p className="muted">No sector metrics extracted yet.</p>
        ) : (
          <div className="cards">
            {sectorNames.map((n) => {
              const m = latest(n)!;
              return (
                <div className="card" key={n}>
                  <div className="muted">{n}</div>
                  <div className="big">{fmtMetric(m)}</div>
                  <div className="muted">FY{m.fiscalYear}</div>
                  <Cite c={m.citation} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel stack" aria-label="Financials">
        <h2>Financials</h2>
        {names.length === 0 ? (
          <p className="muted">No metrics yet. Upload a document below.</p>
        ) : (
          <div className="table-wrap">
            <table data-testid="financials">
              <thead>
                <tr>
                  <th>Metric</th>
                  {years.map((y) => (
                    <th key={y}>FY{y}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {names.map((n) => (
                  <tr key={n}>
                    <td>{n}</td>
                    {years.map((y) => {
                      const m = cell(n, y);
                      return (
                        <td key={y} className="num">
                          {m ? (
                            <>
                              {fmtMetric(m)} <Cite c={m.citation} />
                            </>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel stack" aria-label="Events">
        <h2>Events ({o.events.length})</h2>
        {o.events.length === 0 ? (
          <p className="muted">No flagged events.</p>
        ) : (
          <ul className="events">
            {o.events.map((e) => (
              <li key={e.id}>
                <div className="row wrap">
                  <SeverityBadge s={e.severity} />
                  <TypeBadge t={e.type} />
                  <span className="muted">{e.date}</span>
                  <span className="muted">{e.source.kind === "news" ? "news" : "document"}</span>
                  {e.dollarAmounts[0] != null && <span className="badge">{fmtUsd(e.dollarAmounts[0])}</span>}
                </div>
                <div>
                  <strong>{e.headline}</strong>
                </div>
                {e.source.kind === "document" ? <Cite c={e.source.citation} /> : <Link href="/news?includeFiltered=1">View in news feed</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel stack" aria-label="Documents">
        <h2>Documents ({o.documents.length})</h2>
        <ul className="events">
          {o.documents.map((d) => (
            <li key={d.id}>
              <Link href={`/documents/${d.id}`}>{d.title}</Link>{" "}
              <span className="muted">
                {d.type} {d.fiscalYear ? `FY${d.fiscalYear}` : ""}, {d.pageCount} pp, {d.chunkCount} chunks
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid2">
        <section className="panel stack" aria-label="Ask">
          <h2>Ask about {o.name}</h2>
          <AskBox obligorId={o.id} obligorName={o.name} />
        </section>
        <section className="panel stack" aria-label="Ingest">
          <h2>Ingest a document</h2>
          <UploadForm obligorId={o.id} />
        </section>
      </div>
    </>
  );
}
