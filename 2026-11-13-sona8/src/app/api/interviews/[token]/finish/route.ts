import { json, notFound } from "../../../../../lib/http";
import { extractInterview } from "../../../../../lib/pipeline";
import * as repo from "../../../../../lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const participant = repo.getParticipantByToken(token);
  if (!participant) return notFound("Interview");
  if (!repo.getMessages(participant.id).some((m) => m.role === "user")) {
    return json({ error: "Interview has no answers yet" }, 409);
  }
  const extraction = await extractInterview(participant);
  repo.setStatus(participant.id, "completed", new Date().toISOString());
  return json(extraction);
}
