import Link from "next/link";
import { notFound } from "next/navigation";
import * as repo from "../../../../../../lib/repo";

export const dynamic = "force-dynamic";

export default async function InterviewDetail({ params }: { params: Promise<{ id: string; participantId: string }> }) {
  const { id, participantId } = await params;
  const participant = repo.getParticipant(participantId);
  if (!participant || participant.studyId !== id) notFound();
  const messages = repo.getMessages(participantId);
  const extraction = repo.getExtraction(participantId);

  return (
    <div className="space-y-6">
      <Link href={`/studies/${id}`} className="text-sm text-indigo-600 underline">Back to study</Link>
      <h1 className="text-2xl font-semibold">{participant.name || "Anonymous"} <span className="text-base text-slate-500">{[participant.team, participant.site, participant.role].filter(Boolean).join(" / ")}</span></h1>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 font-medium">Transcript</h2>
          <ul className="space-y-2 text-sm">
            {messages.map((m, i) => (
              <li key={i}><b>{m.role === "user" ? "Participant" : "Interviewer"}:</b> {m.content}</li>
            ))}
          </ul>
        </section>
        <section className="rounded border bg-white p-4">
          <h2 className="mb-3 font-medium">Extraction</h2>
          {extraction ? (
            <pre className="max-h-[32rem] overflow-auto text-xs">{JSON.stringify(extraction, null, 2)}</pre>
          ) : (
            <p className="text-sm text-slate-500">Not extracted yet (interview not finished).</p>
          )}
        </section>
      </div>
    </div>
  );
}
