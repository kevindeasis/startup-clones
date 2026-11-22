import { fail, ok, parseBody } from "@/lib/api";
import { kickoffBody } from "@/lib/schemas";
import { createKickoffProject } from "@/lib/projects";
import { readDb } from "@/lib/store";
import { analyze } from "@/lib/analyze";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readDb().accounts.some((a) => a.id === id)) return fail("account not found", 404);
  const body = await parseBody(req, kickoffBody);
  if ("error" in body) return body.error;
  const r = await createKickoffProject(id, body.data.transcript);
  await analyze(id);
  return ok({ project: r.project, tasks: r.tasks, recap: r.recap, blockers: r.blockers, ...(r.degraded ? { degraded: true } : {}) }, 201);
}
