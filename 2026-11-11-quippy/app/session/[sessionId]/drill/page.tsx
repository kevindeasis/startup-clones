import Link from "next/link";
import { notFound } from "next/navigation";
import { readDb } from "@/lib/db";
import { DrillClient } from "@/components/Drill";

export const dynamic = "force-dynamic";

export default async function DrillPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const db = await readDb();
  const session = db.sessions.find((s) => s.id === sessionId);
  if (!session) notFound();
  const fb = session.feedback;
  if (!fb) return <p>Finish the scene first. <Link className="text-indigo-600 underline" href="/">Home</Link></p>;
  const lineIndex = fb.weakestLineIndex;
  const weak = session.messages.find((m) => m.index === lineIndex)!;
  const partner = [...session.messages].reverse().find((m) => m.role === "partner" && m.index < lineIndex);
  const drill = db.drills.find((d) => d.sessionId === sessionId && d.lineIndex === lineIndex);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Drill your weakest line</h1>
      <DrillClient
        sessionId={sessionId}
        lineIndex={lineIndex}
        partnerLine={partner?.text ?? ""}
        weakLine={weak.text}
        reason={fb.lines.find((l) => l.index === lineIndex)?.reason ?? ""}
        initialAttempts={drill?.attempts ?? []}
        initialDone={drill?.done ?? false}
      />
    </div>
  );
}
