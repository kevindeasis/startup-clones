import type { VoiceProfile } from "./types";

export type VoiceLike = { name: string; lang: string; default?: boolean };

const FEMALE_RE =
  /\b(female|woman|zira|samantha|victoria|karen|susan|hazel|fiona|moira|tessa|allison|ava|serena|kate|amelie|aria|jenny|sara|libby|emma|joanna|ivy|kendra|kimberly|salli|nicole|amy|olivia)\b/i;
const MALE_RE =
  /\b(male|man|david|mark|daniel|alex|fred|george|ryan|guy|james|thomas|oliver|bruce|lee|rishi|matthew|joey|justin|brian|russell|arthur|eric)\b/i;

export type VoicePools<T extends VoiceLike> = { all: T[]; female: T[]; male: T[] };

/** Voices for the page language (falls back to all voices), split by a name-keyword gender heuristic. */
export function buildPools<T extends VoiceLike>(voices: T[], lang = "en"): VoicePools<T> {
  const base = lang.toLowerCase().split("-")[0];
  const inLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const all = inLang.length ? inLang : voices;
  const female = all.filter((v) => FEMALE_RE.test(v.name) && !/\bmale\b/i.test(v.name.replace(/female/i, "")));
  const male = all.filter((v) => MALE_RE.test(v.name) && !FEMALE_RE.test(v.name));
  return { all, female, male };
}

/**
 * Map a voice profile to a concrete browser voice. See cast.ts for the slot convention:
 * 0 = default/narrator, odd = female pool, even = male pool. preferredVoiceName wins when present.
 */
export function resolveVoice<T extends VoiceLike>(profile: VoiceProfile, pools: VoicePools<T>): T | undefined {
  if (profile.preferredVoiceName) {
    const hit = pools.all.find((v) => v.name === profile.preferredVoiceName);
    if (hit) return hit;
  }
  const { all, female, male } = pools;
  if (all.length === 0) return undefined;
  const s = profile.slot;
  if (s <= 0) return all.find((v) => v.default) ?? all[0];
  if (s % 2 === 1) {
    const pool = female.length ? female : all;
    return pool[((s - 1) / 2) % pool.length];
  }
  const pool = male.length ? male : all;
  return pool[(s / 2 - 1) % pool.length];
}

/** Break text at sentence boundaries into pieces <= max chars (long utterances get cut off in Chrome). */
export function splitForSpeech(text: string, max = 200): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+(?:[.!?…]+["”’')\]]*|$)\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  for (const s of sentences) {
    if ((cur + s).length > max && cur) push();
    if (s.length > max) {
      // Very long sentence without terminal punctuation: split at commas/spaces.
      for (const w of s.split(/(?<=[,;:—-])\s+|\s+/)) {
        if ((cur + " " + w).length > max && cur) push();
        cur += (cur ? " " : "") + w;
      }
    } else cur += s;
  }
  push();
  return out.length ? out : [text];
}
