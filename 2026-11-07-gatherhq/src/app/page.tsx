import Link from "next/link";
import { db } from "@/lib/db";
import NewStudyForm from "./NewStudyForm";

export const dynamic = "force-dynamic";

export default function Home() {
  const studies = db()
    .prepare(`SELECT s.*, (SELECT COUNT(*) FROM interviews i WHERE i.study_id = s.id) AS n FROM studies s ORDER BY s.created_at DESC, s.rowid DESC`)
    .all() as { id: string; title: string; goal: string; status: string; created_at: string; n: number }[];
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h1 className="mb-3 text-xl font-semibold">Studies</h1>
        {studies.length === 0 && <p className="text-sm text-stone-500">No studies yet. Create your first one.</p>}
        <ul className="space-y-2" data-testid="studies-list">
          {studies.map((s) => (
            <li key={s.id}>
              <Link href={`/studies/${s.id}`} className="block rounded-lg border border-stone-200 p-3 hover:bg-stone-100 dark:border-stone-800 dark:hover:bg-stone-900">
                <div className="font-medium">{s.title}</div>
                <div className="line-clamp-2 text-sm text-stone-500">{s.goal}</div>
                <div className="mt-1 text-xs text-stone-400">{s.n} interviews · {s.status}</div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">New study</h2>
        <NewStudyForm />
      </section>
    </div>
  );
}
