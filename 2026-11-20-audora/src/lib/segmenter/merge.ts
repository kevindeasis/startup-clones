import type { AgeHint, Character, GenderHint, Segment } from "../types";
import { assignVoice } from "./cast";
import { NARRATOR_NAME, type CharacterHint, type ChunkResult } from "./schema";

/** Normalised lookup key: lowercase, no leading article, collapsed whitespace/punctuation. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[“”"’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "");
}

function keysOf(c: Pick<Character, "name" | "aliases">): string[] {
  return [c.name, ...c.aliases].map(nameKey);
}

export function findCharacter(cast: Character[], name: string): Character | undefined {
  const k = nameKey(name);
  if (!k) return undefined;
  if (k === nameKey(NARRATOR_NAME)) return cast.find((c) => c.isNarrator);
  return cast.find((c) => !c.isNarrator && keysOf(c).includes(k));
}

function addAlias(c: Character, alias: string) {
  const k = nameKey(alias);
  if (!k || keysOf(c).includes(k)) return;
  c.aliases.push(alias.trim());
}

function upsertCharacter(cast: Character[], hint: CharacterHint): Character | undefined {
  if (nameKey(hint.name) === nameKey(NARRATOR_NAME)) return cast.find((c) => c.isNarrator);
  let existing = findCharacter(cast, hint.name);
  if (!existing) {
    // The hint may only match through one of its aliases.
    for (const a of hint.aliases) {
      existing = findCharacter(cast, a);
      if (existing) break;
    }
  }
  if (existing) {
    addAlias(existing, hint.name);
    hint.aliases.forEach((a) => addAlias(existing!, a));
    if (existing.genderHint === "unknown" && hint.genderHint !== "unknown") existing.genderHint = hint.genderHint;
    if (existing.ageHint === "unknown" && hint.ageHint !== "unknown") existing.ageHint = hint.ageHint;
    if (!existing.personality && hint.personality) existing.personality = hint.personality;
    return existing;
  }
  return createCharacter(cast, hint.name, hint.genderHint, hint.ageHint, hint.personality, hint.aliases);
}

function createCharacter(
  cast: Character[], name: string, genderHint: GenderHint, ageHint: AgeHint, personality: string, aliases: string[] = [],
): Character {
  const { voice, color } = assignVoice(cast, genderHint, ageHint);
  const c: Character = {
    id: `c${cast.filter((x) => !x.isNarrator).length + 1}`,
    name: name.trim(), aliases: [], isNarrator: false, genderHint, ageHint, personality, voice, color,
  };
  aliases.forEach((a) => addAlias(c, a));
  cast.push(c);
  return c;
}

/**
 * Merge one chunk result into cast + segments (mutates both arrays). Speaker names are mapped to
 * characterIds case-insensitively on name or alias; unknown speakers become new characters.
 */
export function applyChunkResult(cast: Character[], segments: Segment[], result: ChunkResult, chunkIndex: number): void {
  for (const hint of result.characters) upsertCharacter(cast, hint);
  const narrator = cast.find((c) => c.isNarrator)!;
  for (const seg of result.segments) {
    const text = seg.text.trim();
    if (!text) continue;
    let character: Character | undefined;
    if (seg.kind === "narration") character = narrator;
    else {
      character = findCharacter(cast, seg.speaker) ?? createCharacter(cast, seg.speaker, "unknown", "unknown", "");
    }
    segments.push({
      index: segments.length, chunkIndex, kind: seg.kind, characterId: character.id, text,
      ...(seg.emotion ? { emotion: seg.emotion } : {}),
    });
  }
}
