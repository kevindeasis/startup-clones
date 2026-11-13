import { json, notFound } from "../../../../lib/http";
import * as repo from "../../../../lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const study = repo.getStudy(id);
  if (!study) return notFound("Study");
  return json({ study, participants: repo.listParticipants(id), synthesis: repo.getSynthesis(id) ?? null });
}
