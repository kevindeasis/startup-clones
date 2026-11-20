import type { AgeHint, Character, GenderHint, VoiceProfile } from "../types";

export const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#0aa5a5",
  "#d6336c", "#8a6d00", "#6a994e", "#7048e8", "#c2410c", "#1c7ed6",
];
export const NARRATOR_COLOR = "#6b7280";

/**
 * Voice slots (interpreted client-side, see voices.ts):
 *   0        -> the narrator / default voice
 *   odd n    -> the ((n-1)/2)-th voice of the "female-sounding" pool
 *   even n>0 -> the (n/2-1)-th voice of the "male-sounding" pool
 */
const FEMALE_SLOTS = [1, 3, 5, 7, 9, 11];
const MALE_SLOTS = [2, 4, 6, 8, 10, 12];
const NEUTRAL_SLOTS = [13, 14, 15, 16];

const DELTAS: Array<[number, number]> = [
  [0, 0], [0.08, 0], [-0.08, 0], [0.16, 0.03], [-0.16, -0.03],
  [0.24, 0.05], [-0.24, -0.05], [0.04, -0.05], [-0.04, 0.05],
];

function base(gender: GenderHint, age: AgeHint): { pitch: number; rate: number } {
  let pitch = gender === "female" ? 1.12 : gender === "male" ? 0.9 : 1.0;
  let rate = 1.0;
  if (age === "child") { pitch = Math.max(pitch, 1.0) + 0.25; rate = 1.05; }
  else if (age === "young") { pitch += 0.05; rate = 1.03; }
  else if (age === "elder") { pitch = Math.min(pitch, 1.0) - 0.15; rate = 0.9; }
  return { pitch, rate };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function narratorVoice(): VoiceProfile {
  return { slot: 0, pitch: 1.0, rate: 1.0 };
}

export function createNarrator(): Character {
  return {
    id: "narrator", name: "Narrator", aliases: [], isNarrator: true,
    genderHint: "neutral", ageHint: "adult", personality: "Warm, even storyteller",
    voice: narratorVoice(), color: NARRATOR_COLOR,
  };
}

const key = (v: VoiceProfile) => `${v.slot}|${v.pitch}|${v.rate}`;

/** Deterministic: next unused (slot, pitch, rate) combination for the hints, given the existing cast. */
export function assignVoice(cast: Character[], gender: GenderHint, age: AgeHint): { voice: VoiceProfile; color: string } {
  const used = new Set(cast.map((c) => key(c.voice)));
  const slots = gender === "female" ? FEMALE_SLOTS : gender === "male" ? MALE_SLOTS : NEUTRAL_SLOTS;
  const b = base(gender, age);
  // Prefer each slot once with the base delta before reusing a slot with a different delta.
  for (let d = 0; d < DELTAS.length * 4; d++) {
    const [dp, dr] = DELTAS[d % DELTAS.length];
    const wrap = Math.floor(d / DELTAS.length) * 0.03;
    for (const slot of slots) {
      const voice: VoiceProfile = {
        slot,
        pitch: round2(clamp(b.pitch + dp + wrap, 0.5, 2)),
        rate: round2(clamp(b.rate + dr, 0.5, 2)),
      };
      if (!used.has(key(voice))) return { voice, color: nextColor(cast) };
    }
  }
  // Practically unreachable; keep going with a unique slot.
  return { voice: { slot: 100 + cast.length, pitch: 1, rate: 1 }, color: nextColor(cast) };
}

export function nextColor(cast: Character[]): string {
  const n = cast.filter((c) => !c.isNarrator).length;
  return PALETTE[n % PALETTE.length];
}
