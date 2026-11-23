import Link from "next/link";
import { notFound } from "next/navigation";
import { fitBand } from "@/lib/fit";
import { getPursuitDetail } from "@/lib/pursuits";
import { DraftPanel } from "../../components/DraftPanel";
import { TaskList } from "../../components/TaskList";
import { Chip, Fit } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function PursuitPage({ params }: { params: Promise<{ id: string }> }) {
  const detail = await getPursuitDetail((await params).id);
  if (!detail) notFound();
  const { pursuit, agency, tasks, notes } = detail;
  return (
    <>
      <div className="row">
        <div>
          <h1>{pursuit.title}</h1>
          <p className="sub">
            <Link href={`/agencies/${pursuit.agencyId}`}>{agency?.name}</Link> &middot; stage: {pursuit.stage} &middot; bid due: {pursuit.dueDate ?? "not known (stage-based horizon)"} &middot; status: {pursuit.status}
          </p>
          <div className="chips">
            {pursuit.documentId && <Link href={`/documents/${pursuit.documentId}`}>Solicitation &amp; bid review</Link>}
          </div>
        </div>
        <Fit score={pursuit.fitScore} band={fitBand(pursuit.fitScore)} />
      </div>
      <h2>Task plan</h2>
      <TaskList initial={tasks} />
      <h2>Drafts</h2>
      <DraftPanel pursuitId={pursuit.id} initial={notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt }))} />
      <h2>Timeline</h2>
      <div className="card">
        {[...pursuit.events].reverse().map((e) => (
          <div key={e.id} className="task">
            <Chip>{e.type}</Chip>
            <span style={{ flex: 1 }}>{e.summary}{e.documentId ? <> <Link href={`/documents/${e.documentId}${e.page ? `?page=${e.page}` : ""}`}>[source]</Link></> : null}</span>
            <span className="muted">{e.at.slice(0, 16).replace("T", " ")}</span>
          </div>
        ))}
      </div>
    </>
  );
}
