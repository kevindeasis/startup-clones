import { after, NextResponse } from "next/server";
import { isRunning, runGeneration } from "@/lib/generate";
import { resolveMode } from "@/lib/llm-mode";
import { getStory, saveStory } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const sync = new URL(req.url).searchParams.get("sync") === "1";

  if (story.status === "ready" && !sync) return NextResponse.json({ status: "ready", mode: story.mode });
  if (story.status === "generating" && isRunning(id)) {
    // Idempotent while generating.
    return NextResponse.json({ status: "generating", mode: story.mode });
  }

  if (sync) {
    const done = await runGeneration(id);
    return NextResponse.json({
      status: done?.status ?? "error", mode: done?.mode, error: done?.error,
      chunksDone: done?.chunksDone, chunksTotal: done?.chunksTotal,
    });
  }

  story.status = "generating";
  story.mode = resolveMode();
  saveStory(story);
  const delayMs = story.mode === "mock" ? Number(process.env.MOCK_CHUNK_DELAY_MS ?? 600) : 0;
  after(() => runGeneration(id, { delayMs }));
  return NextResponse.json({ status: "generating", mode: story.mode });
}
