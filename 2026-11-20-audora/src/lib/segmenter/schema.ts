import { z } from "zod";

export const characterHintSchema = z.object({
  name: z.string().min(1).describe("Display name of the character, e.g. 'Alice' or 'The Queen'"),
  aliases: z.array(z.string()).describe("Other names/titles used for the same character in the text"),
  genderHint: z.enum(["female", "male", "neutral", "unknown"]),
  ageHint: z.enum(["child", "young", "adult", "elder", "unknown"]),
  personality: z.string().describe("One short phrase describing how the character speaks"),
});

export const segmentSchema = z.object({
  kind: z.enum(["narration", "dialogue"]),
  speaker: z.string().min(1).describe("Display name of the speaker; 'Narrator' for narration"),
  text: z.string().min(1).describe("Verbatim text of this segment"),
  emotion: z.string().optional().describe("Optional one-word delivery hint, e.g. 'angry'"),
});

export const chunkResultSchema = z.object({
  segments: z.array(segmentSchema),
  characters: z.array(characterHintSchema),
});

export type ChunkResult = z.infer<typeof chunkResultSchema>;
export type CharacterHint = z.infer<typeof characterHintSchema>;
export type SegmentDraft = z.infer<typeof segmentSchema>;

export const NARRATOR_NAME = "Narrator";
export const UNKNOWN_SPEAKER = "Unknown Speaker";
