import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { PATTERN_LABELS } from "@/lib/patterns";
import { progressFrom } from "@/lib/progress";

export const dynamic = "force-dynamic";

const CHIP = {
  landed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  okay: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  backfired: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
} as const;

export default async function FeedbackPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) notFound();
  const scenario = db.scenarios.find((s) => s.id === session.scenarioId)!;
  const fb = session.feedback;
  if (!fb) {
    return <p>No feedback yet. <Link className="text-indigo-600 underline" href={`/practice/${scenario.id}?s=${session.id}`}>Back to the scene</Link>.</p>;
  }
  const drill = db.drills.find((d) => d.sessionId === sessionId && d.lineIndex === fb.weakestLineIndex);
  const { states } = progressFrom(db);
  const next = db.scenarios.filter((s) => s.unitId !== "custom" && states[s.id] === "unlocked")[0];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{scenario.title}: feedback</h1>
        <p className="mt-1 text-sm text-stone-500">Pattern: <strong>{PATTERN_LABELS[fb.pattern]}</strong>{session.mock && " | Mock LLM feedback (heuristic)"}</p>
      </div>
      <div className="flex items-center gap-4 rounded-xl border border-stone-300 p-4 dark:border-stone-700">
        <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400" data-testid="score">{fb.score}</div>
        <p className="text-sm">{fb.summary}</p>
      </div>
      <div className="flex flex-col gap-3">
        {session.messages.map((m) => {
          const line = fb.lines.find((l) => l.index === m.index);
          if (m.role === "partner") {
            return <div key={m.index} className="max-w-[85%] self-start rounded-2xl bg-stone-200 px-3 py-2 text-sm dark:bg-stone-800"><span className="block text-xs opacity-70">{scenario.character}</span>{m.text}</div>;
          }
          return (
            <div key={m.index} className="max-w-[90%] self-end">
              <div className={`rounded-2xl bg-indigo-600 px-3 py-2 text-sm text-white ${m.index === fb.weakestLineIndex ? "ring-2 ring-amber-400" : ""}`}><span className="block text-xs opacity-70">You</span>{m.text}</div>
              {line && (
                <div className="mt-1 space-y-1 text-sm">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[line.verdict]}`}>{line.verdict}</span>
                  <span className="ml-2 text-stone-600 dark:text-stone-400">{line.reason}</span>
                  {line.stronger && <p className="rounded-lg border border-dashed border-emerald-400 p-2"><span className="font-medium">Stronger:</span> {line.stronger}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href={`/session/${sessionId}/drill`} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          {drill?.done ? "Review drill" : "Drill this line"}
        </Link>
        {next && <Link href="/" className="rounded-lg border border-stone-300 px-4 py-2 text-sm dark:border-stone-700">Next up: {next.title}</Link>}
        <Link href="/progress" className="rounded-lg border border-stone-300 px-4 py-2 text-sm dark:border-stone-700">Progress</Link>
      </div>
    </div>
  );
}
