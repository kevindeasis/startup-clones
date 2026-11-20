import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, type LanguageModel } from "ai";
import type { Character } from "../types";
import { countWords } from "./chunk";
import { chunkResultSchema, type ChunkResult } from "./schema";

export const SYSTEM_PROMPT = `You are an audiobook script editor. You receive one chunk of a story and must split it into ordered segments for a multi-voice audiobook.

Rules:
- The segments, concatenated in order, must reproduce the chunk text verbatim: every sentence appears exactly once, in order, nothing paraphrased, nothing dropped, nothing added.
- Text inside quotation marks is a "dialogue" segment attributed to the character who speaks it. Infer implied speakers from context and turn-taking when there is no explicit tag.
- Attribution tags such as "said Alice" and all other prose are "narration" segments with speaker "Narrator".
- Keep the existing cast names (given below) for recurring characters; if the text uses another name or title for an existing character, use the existing name as the speaker and list the variant in that character's aliases.
- Add every newly discovered speaking character to "characters" with gender, age and a short personality hint (use "unknown" when the text gives no clue).
- "speaker" must be the character's display name, or "Narrator" for narration. Optionally give a one-word "emotion" for dialogue.`;

export function buildPrompt(chunk: string, cast: Character[]): string {
  const known = cast
    .filter((c) => !c.isNarrator)
    .map((c) => `- ${c.name}${c.aliases.length ? ` (aliases: ${c.aliases.join(", ")})` : ""} [${c.genderHint}, ${c.ageHint}]`)
    .join("\n");
  return `Existing cast:\n${known || "(none yet)"}\n\nChunk text:\n"""\n${chunk}\n"""`;
}

const norm = (s: string) => s.replace(/[\s"“”]+/g, "").toLowerCase();

/** Cheap fidelity check: the segments must contain (almost) all of the words of the chunk. */
export function coversChunk(result: ChunkResult, chunk: string): boolean {
  const have = countWords(result.segments.map((s) => s.text).join(" "));
  const want = countWords(chunk);
  if (result.segments.length === 0) return false;
  return have >= want * 0.9 && have <= want * 1.1 + 5 && norm(result.segments[0].text).length > 0;
}

/**
 * One structured-output call (AI SDK v7: generateText + Output.object). Throws on failure;
 * the caller handles the retry/fallback policy.
 */
export async function segmentChunkLive(chunk: string, cast: Character[], modelId: string, modelOverride?: LanguageModel): Promise<ChunkResult> {
  // createAnthropic() reads ANTHROPIC_API_KEY from the environment. modelOverride exists for tests.
  const model = modelOverride ?? createAnthropic()(modelId);
  const { output } = await generateText({
    model,
    output: Output.object({ schema: chunkResultSchema, name: "chunk_script", description: "Segmented audiobook script for one chunk" }),
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(chunk, cast),
    maxOutputTokens: 16000,
  });
  if (!coversChunk(output, chunk)) throw new Error("Model output does not cover the chunk text");
  return output;
}
