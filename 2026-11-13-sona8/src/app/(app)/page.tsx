import Link from "next/link";
import { listStudies } from "../../lib/repo";

export const dynamic = "force-dynamic";

export default function Home() {
  const studies = listStudies();
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Studies</h1>
      <p className="mb-6 text-sm text-slate-600">Interview employees about how work really gets done, then synthesise a process map.</p>
      {studies.length === 0 && <p className="text-slate-500">No studies yet.</p>}
      <ul className="space-y-3">
        {studies.map((s) => (
          <li key={s.id}>
            <Link href={`/studies/${s.id}`} className="block rounded border bg-white p-4 hover:border-slate-400">
              <div className="font-medium">{s.title}</div>
              <div className="text-sm text-slate-600">{s.topic}</div>
              <div className="mt-2 text-xs text-slate-500">
                {s.completedCount} completed / {s.participantCount} participants
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
