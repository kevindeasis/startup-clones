import Link from "next/link";
import { readDb } from "@/lib/db";
import { PATTERN_LABELS } from "@/lib/patterns";
import { progressFrom } from "@/lib/progress";
import type { Pattern } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const db = await readDb();
  const { progress } = progressFrom(db);
  const title = (id: string) => db.scenarios.find((s) => s.id === id)?.title ?? id;
  const counts = Object.entries(progress.patternCounts).sort((a, b) => b[1]! - a[1]!) as [Pattern, number][];
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Progress</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-stone-300 p-4 dark:border-stone-700">
          <p className="text-sm text-stone-500">Streak</p>
          <p className="text-3xl font-bold" data-testid="streak">Streak: {progress.streakDays} day{progress.streakDays === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-stone-300 p-4 dark:border-stone-700">
          <p className="text-sm text-stone-500">Sessions</p>
          <p className="text-3xl font-bold">{progress.sessions.length}</p>
        </div>
        <div className="rounded-xl border border-stone-300 p-4 dark:border-stone-700">
          <p className="text-sm text-stone-500">Top pattern</p>
          <p className="text-xl font-bold">{progress.topPattern ? PATTERN_LABELS[progress.topPattern] : "None yet"}</p>
        </div>
      </div>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Your patterns</h2>
        {counts.length === 0 ? <p className="text-sm text-stone-500">Finish a session to see your patterns.</p> : (
          <ul className="space-y-1">
            {counts.map(([p, n]) => <li key={p} className="flex justify-between rounded border border-stone-200 px-3 py-1.5 text-sm dark:border-stone-800"><span>{PATTERN_LABELS[p]} ({p})</span><span className="font-semibold">{n}</span></li>)}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-lg font-semibold">Completed sessions</h2>
        {progress.sessions.length === 0 ? <p className="text-sm text-stone-500">No completed sessions yet. <Link href="/" className="text-indigo-600 underline">Start one</Link>.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500"><tr><th className="py-1">Date</th><th>Scenario</th><th>Score</th><th>Pattern</th></tr></thead>
            <tbody>
              {progress.sessions.map((s) => (
                <tr key={s.id} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="py-1.5">{new Date(s.endedAt).toLocaleDateString()}</td>
                  <td><Link className="text-indigo-600 underline" href={`/session/${s.id}/feedback`}>{title(s.scenarioId)}</Link></td>
                  <td>{s.score}</td><td>{s.pattern}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
