import { ensureOpening } from "../../../../lib/chat";
import { json, notFound } from "../../../../lib/http";
import * as repo from "../../../../lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const participant = repo.getParticipantByToken(token);
  const study = participant && repo.getStudy(participant.studyId);
  if (!participant || !study) return notFound("Interview");
  ensureOpening(participant, study);
  return json({
    study: { title: study.title, topic: study.topic },
    participant: { name: participant.name, team: participant.team, site: participant.site, role: participant.role, status: participant.status },
    messages: repo.getMessages(participant.id),
    coverage: repo.getCoverage(participant.id),
    extraction: participant.status === "completed" ? repo.getExtraction(participant.id) ?? null : null,
  });
}
