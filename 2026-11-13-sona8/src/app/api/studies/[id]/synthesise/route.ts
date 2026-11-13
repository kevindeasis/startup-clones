import { json, notFound } from "../../../../../lib/http";
import { synthesiseStudy } from "../../../../../lib/pipeline";
import * as repo from "../../../../../lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!repo.getStudy(id)) return notFound("Study");
  try {
    return json(await synthesiseStudy(id));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Synthesis failed" }, 409);
  }
}
