import { json, notFound, parseBody } from "../../../../../lib/http";
import * as repo from "../../../../../lib/repo";
import { CreateParticipantBody } from "../../../../../lib/schemas";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!repo.getStudy(id)) return notFound("Study");
  const body = await parseBody(req, CreateParticipantBody);
  if ("error" in body) return body.error;
  const participant = repo.addParticipant(id, body.data);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return json({ ...participant, link: `${base}/interview/${participant.token}` }, 201);
}
