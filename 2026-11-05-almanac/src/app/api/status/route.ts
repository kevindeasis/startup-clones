import { NextResponse } from "next/server";
import { getProvider } from "@/lib/brain/llm";
import { listPages, listRuns, listSources } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const sources = listSources();
  const runs = listRuns();
  return NextResponse.json({
    provider: getProvider(),
    lastCompiledAt: runs.length ? runs[runs.length - 1].finishedAt : null,
    sourceCount: sources.length,
    pageCount: listPages().length,
    uncompiledCount: sources.filter((s) => !s.compiledAt).length,
  });
}
