import Link from "next/link";
import { agencyMap } from "@/lib/data";
import { nextOpenTask } from "@/lib/planner";
import { readCollection } from "@/lib/store";
import type { Pursuit, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PursuitsPage() {
  const [pursuits, tasks, agencies] = await Promise.all([readCollection<Pursuit>("pursuits"), readCollection<Task>("tasks"), agencyMap()]);
  return (
    <>
      <h1>Pursuits</h1>
      <p className="sub">Bids you are tracking. Start one from a signal or a solicitation.</p>
      <table>
        <thead><tr><th>Project</th><th>Agency</th><th>Stage</th><th>Bid due</th><th>Next task due</th><th>Open tasks</th></tr></thead>
        <tbody>
          {pursuits.map((p) => {
            const mine = tasks.filter((t) => t.pursuitId === p.id);
            const next = nextOpenTask(mine);
            return (
              <tr key={p.id}>
                <td><Link href={`/pursuits/${p.id}`}>{p.title}</Link></td>
                <td>{agencies.get(p.agencyId)?.name}</td>
                <td>{p.stage}</td>
                <td>{p.dueDate ?? "-"}</td>
                <td>{next ? `${next.dueDate} (${next.title})` : "-"}</td>
                <td>{mine.filter((t) => !t.done).length}</td>
              </tr>
            );
          })}
          {pursuits.length === 0 && <tr><td colSpan={6} className="muted">No pursuits yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
