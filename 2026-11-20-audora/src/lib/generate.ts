import { resolveMode, resolveModel } from "./llm-mode";
import { chunkText } from "./segmenter/chunk";
import { createNarrator } from "./segmenter/cast";
import { applyChunkResult } from "./segmenter/merge";
import { segmentHeuristic } from "./segmenter/heuristic";
import { segmentChunkLive } from "./segmenter/llm";
import type { ChunkResult } from "./segmenter/schema";
import { getStory, saveStory } from "./store";
import type { Story } from "./types";

const g = globalThis as unknown as { __fullcastRunning?: Set<string> };
const running = (g.__fullcastRunning ??= new Set<string>());

export const isRunning = (id: string) => running.has(id);

function recentSpeakers(story: Story): string[] {
  const names = new Map(story.cast.map((c) => [c.id, c.name]));
  const out: string[] = [];
  for (let i = story.segments.length - 1; i >= 0 && out.length < 2; i--) {
    const s = story.segments[i];
    const n = s.kind === "dialogue" ? names.get(s.characterId) : undefined;
    if (n && n !== "Unknown Speaker" && !out.includes(n)) out.push(n);
  }
  return out.reverse();
}

async function segmentOne(story: Story, chunkText_: string): Promise<{ result: ChunkResult; warning?: string }> {
  const heuristic = () => segmentHeuristic(chunkText_, { cast: story.cast, recentSpeakers: recentSpeakers(story) });
  if (story.mode === "mock") return { result: heuristic() };
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { result: await segmentChunkLive(chunkText_, story.cast, story.model ?? resolveModel()) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { result: heuristic(), warning: `LLM failed twice, used heuristic fallback for a chunk: ${lastError}`.slice(0, 500) };
}

/** Process all remaining chunks of a story, persisting after every chunk. */
export async function runGeneration(id: string, opts: { delayMs?: number } = {}): Promise<Story | null> {
  if (running.has(id)) return getStory(id);
  running.add(id);
  try {
    let story = getStory(id);
    if (!story) return null;
    const chunks = chunkText(story.text);
    if (story.status !== "generating" || story.chunksDone === 0) {
      story.cast = [createNarrator()];
      story.segments = [];
      story.chunksDone = 0;
    }
    story.mode = resolveMode();
    story.model = story.mode === "live" ? resolveModel() : undefined;
    story.status = "generating";
    story.error = undefined;
    story.chunksTotal = chunks.length;
    if (story.mode === "live" && !process.env.ANTHROPIC_API_KEY) throw new Error("LLM_MODE=live requires ANTHROPIC_API_KEY");
    saveStory(story);

    for (let i = story.chunksDone; i < chunks.length; i++) {
      const { result, warning } = await segmentOne(story, chunks[i].text);
      // Re-read: the user may have PATCHed the cast while the (slow) LLM call was in flight.
      const fresh = getStory(id);
      if (!fresh) return null; // deleted meanwhile
      story = fresh;
      applyChunkResult(story.cast, story.segments, result, i);
      story.chunksDone = i + 1;
      if (warning) story.error = warning;
      saveStory(story);
      if (opts.delayMs && i < chunks.length - 1) await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    story.status = "ready";
    return saveStory(story);
  } catch (e) {
    const s = getStory(id);
    if (s) {
      s.status = "error";
      s.error = e instanceof Error ? e.message : String(e);
      saveStory(s);
    }
    return s;
  } finally {
    running.delete(id);
  }
}
