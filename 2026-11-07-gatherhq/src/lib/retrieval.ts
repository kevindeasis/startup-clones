import MiniSearch from "minisearch";
import { getInterviews, getMessages } from "./db";
import type { Chunk } from "./llm";

/** Build chunks (one Q/A pair each) for all interviews of a study that have at least one answer. */
export function buildChunks(studyId: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const iv of getInterviews(studyId)) {
    const msgs = getMessages(iv.id);
    const name = iv.participant_name || "Participant";
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === "assistant" && msgs[i + 1].role === "user") {
        chunks.push({
          id: `${iv.id}:${msgs[i + 1].id}`, interview_id: iv.id, participant: name,
          text: `${msgs[i].content}\n${msgs[i + 1].content}`,
        });
      }
    }
  }
  return chunks;
}

export function retrieve(studyId: string, query: string, k = 8): Chunk[] {
  const chunks = buildChunks(studyId);
  if (!chunks.length) return [];
  const ms = new MiniSearch<Chunk>({ fields: ["text"], storeFields: ["interview_id", "participant", "text"], searchOptions: { fuzzy: 0.2, prefix: true, combineWith: "OR" } });
  ms.addAll(chunks);
  const hits = ms.search(query);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const top = hits.slice(0, k).map((h) => byId.get(String(h.id))!);
  return top.length ? top : chunks.slice(0, Math.min(k, 3)); // fall back so mock/short queries still get context
}
