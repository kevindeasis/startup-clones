import Link from "next/link";
import { listOpportunities } from "@/lib/store";
import { STAGES } from "@/lib/types";
import type { Stage } from "@/lib/types";
import { LINE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<Stage, string> = {
  intake: "Intake",
  needs_info: "Needs info",
  quoting: "Quoting",
  quoted: "Quoted",
  selected: "Selected",
};

export default function Dashboard() {
  const opps = listOpportunities();
  return (
    <>
      <div className="row between">
        <div>
          <h1>Pipeline</h1>
          <p className="muted">Opportunities by stage. Nothing is bound until a broker selects a quote.</p>
        </div>
        <Link href="/intake" className="btn primary">New intake</Link>
      </div>
      <div className="board">
        {STAGES.map((stage) => {
          const items = opps.filter((o) => o.stage === stage);
          return (
            <section key={stage} className="column" aria-label={STAGE_LABEL[stage]}>
              <h2>{STAGE_LABEL[stage]} <span className="count">{items.length}</span></h2>
              {items.length === 0 && <p className="muted small">Empty</p>}
              {items.map((o) => (
                <Link key={o.id} href={`/opportunities/${o.id}`} className="card">
                  <strong>{o.profile.businessName ?? "Unnamed business"}</strong>
                  <div className="small muted">{o.profile.requestedLines.map((l) => LINE_LABELS[l]).join(", ") || "No lines"}</div>
                  <div className="small">
                    {o.missing.length > 0 && <span className="tag warn">{o.missing.length} missing</span>}
                    {o.quotes.length > 0 && <span className="tag">{o.quotes.length} quotes</span>}
                  </div>
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
