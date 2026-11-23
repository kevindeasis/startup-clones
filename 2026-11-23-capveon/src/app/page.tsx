import { agencyMap } from "@/lib/data";
import { querySignals } from "@/lib/queries";
import { CATEGORIES, STAGES } from "@/lib/types";
import { formatMoney } from "@/lib/util";
import { TrackButton } from "./components/TrackButton";
import { CATEGORY_LABEL, Chip, DocLink, Fit } from "./components/ui";
import Link from "next/link";
import { readCollection } from "@/lib/store";
import type { Document } from "@/lib/types";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SignalsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const f = { category: one(sp.category), stage: one(sp.stage), agencyId: one(sp.agencyId), minFit: one(sp.minFit), q: one(sp.q) };
  const [signals, agencies, docs] = await Promise.all([
    querySignals({ category: f.category || undefined, stage: f.stage || undefined, agencyId: f.agencyId || undefined, minFit: f.minFit ? Number(f.minFit) : undefined, q: f.q || undefined }),
    agencyMap(),
    readCollection<Document>("documents"),
  ]);
  const docTitle = new Map(docs.map((d) => [d.id, d.title]));
  return (
    <>
      <h1>Early signals</h1>
      <p className="sub">Projects found in minutes, budgets and plans, ranked by fit to your profile. Fictional demo data.</p>
      <form className="filters" method="get">
        <label>Search<input name="q" defaultValue={f.q} placeholder="title, agency, evidence" /></label>
        <label>Category
          <select name="category" defaultValue={f.category}>
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label>Stage
          <select name="stage" defaultValue={f.stage}>
            <option value="">All</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>Agency
          <select name="agencyId" defaultValue={f.agencyId}>
            <option value="">All</option>
            {[...agencies.values()].map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Min fit<input name="minFit" type="number" min={0} max={100} defaultValue={f.minFit} style={{ width: 80 }} /></label>
        <button type="submit">Filter</button>
        <Link className="btn secondary" href="/">Reset</Link>
      </form>
      {signals.length === 0 && <p className="muted">No signals. Run <code>npm run seed</code> or add a document.</p>}
      {signals.map((s) => {
        const src = s.sources[s.sources.length - 1];
        return (
          <div className="card" key={s.id}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 240 }}>
                <strong>{s.projectTitle}</strong>
                <div className="muted"><Link href={`/agencies/${s.agencyId}`}>{s.agencyName}</Link></div>
                <div className="chips">
                  <Chip>{CATEGORY_LABEL[s.category]}</Chip>
                  <Chip>stage: {s.stage}</Chip>
                  <Chip>value: {s.valueText ?? formatMoney(s.estimatedValue)}</Chip>
                  <Chip>timing: {s.timing ?? "not stated"}</Chip>
                </div>
                <div>{s.fitRationale}</div>
              </div>
              <div>
                <Fit score={s.fitScore} band={s.band} />
                <div style={{ textAlign: "right", marginTop: 8 }}>
                  <TrackButton signalId={s.id} pursuitId={s.pursuitId} />
                </div>
              </div>
            </div>
            {src && (
              <div className="src">
                Source: <DocLink id={src.documentId} page={src.page}>{docTitle.get(src.documentId) ?? "document"}, p.{src.page}</DocLink>
                {s.sources.length > 1 ? ` (+${s.sources.length - 1} more)` : ""}
                <div>&ldquo;{src.quote}&rdquo;</div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
