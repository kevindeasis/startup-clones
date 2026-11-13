import { buildContextMarkdown } from "../../../../../lib/context";
import { notFound } from "../../../../../lib/http";
import * as repo from "../../../../../lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const study = repo.getStudy(id);
  const stored = repo.getSynthesis(id);
  if (!study || !stored) return notFound("Synthesis");
  const body = buildContextMarkdown(study, stored.synthesis, stored.mermaid, stored.interviewCount);
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
