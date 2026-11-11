import { notFound, redirect } from "next/navigation";
import { readDb } from "@/lib/db";
import { progressFrom } from "@/lib/progress";
import { Practice } from "@/components/Practice";
import { StartButton } from "@/components/StartButton";

export const dynamic = "force-dynamic";

export default async function PracticePage({ params, searchParams }: { params: Promise<{ scenarioId: string }>; searchParams: Promise<{ s?: string }> }) {
  const { scenarioId } = await params;
  const { s } = await searchParams;
  const db = await readDb();
  const scenario = db.scenarios.find((x) => x.id === scenarioId);
  if (!scenario) notFound();
  if (progressFrom(db).states[scenarioId] === "locked") redirect("/");
  const session = s ? db.sessions.find((x) => x.id === s && x.scenarioId === scenarioId) : undefined;
  if (session?.feedback) redirect(`/session/${session.id}/feedback`);
  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{scenario.title}</h1>
        <p>{scenario.character}, {scenario.persona}.</p>
        <p className="text-stone-600 dark:text-stone-400">{scenario.setting}. Goal: {scenario.goal}</p>
        <StartButton scenarioId={scenarioId} label="Begin" />
      </div>
    );
  }
  return (
    <Practice
      key={session.id}
      sessionId={session.id}
      scenario={scenario}
      initial={session.messages.map((m) => ({ role: m.role, text: m.text }))}
      focus={session.focus}
    />
  );
}
