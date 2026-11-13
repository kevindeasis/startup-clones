import { recordUserTurn, replyResponse } from "../../../../../lib/chat";
import { json, notFound, parseBody } from "../../../../../lib/http";
import * as repo from "../../../../../lib/repo";
import { ChatBody } from "../../../../../lib/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const participant = repo.getParticipantByToken(token);
  const study = participant && repo.getStudy(participant.studyId);
  if (!participant || !study) return notFound("Interview");
  if (participant.status === "completed") return json({ error: "Interview already completed" }, 409);
  const body = await parseBody(req, ChatBody);
  if ("error" in body) return body.error;

  const covered = await recordUserTurn(participant, body.data.message);
  return replyResponse(participant, study, repo.getMessages(participant.id), { "X-Coverage": JSON.stringify(covered) });
}
