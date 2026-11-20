import type { AgeHint, Character, GenderHint } from "../types";
import { findCharacter, nameKey } from "./merge";
import { NARRATOR_NAME, UNKNOWN_SPEAKER, type CharacterHint, type ChunkResult, type SegmentDraft } from "./schema";
import { splitParagraphs } from "./chunk";

export type HeuristicContext = {
  /** Cast discovered so far (names are reused for recurring characters). */
  cast: Character[];
  /** Names of the most recent distinct dialogue speakers, oldest first (for turn-taking across chunks). */
  recentSpeakers: string[];
};

const VERBS =
  "said|asked|replied|cried|shouted|whispered|answered|exclaimed|muttered|called|continued|added|remarked|observed|" +
  "interrupted|declared|repeated|sighed|laughed|growled|pleaded|sobbed|yelled|snapped|inquired|protested|suggested|" +
  "returned|thought|went on|persisted|screamed|roared|groaned|stammered|murmured|began|cried out|sang|grumbled|retorted|bawled|" +
  "ventured|hissed|gasped|chuckled|mumbled|wailed|complained|agreed|objected|insisted|explained|demanded|warned|promised|boasted|sniffed";
const NAME = "(?:[Tt]he )?[A-Z][A-Za-z'’-]*(?: (?:of )?[A-Z][A-Za-z'’-]*){0,2}";
const PRONOUN = "[Ss]he|[Hh]e";

// "…," said X   /   "…," said the X
const AFTER_VERB_FIRST = new RegExp(`^\\s*,?\\s*(?:${VERBS})\\s+(${NAME})`);
// "…" X said   /   "…" X [verb]ed
const AFTER_NAME_FIRST = new RegExp(`^\\s*,?\\s*(${NAME}|${PRONOUN})\\s+(?:${VERBS})\\b`);
// X said, "…"   /   X said softly, "…"
const BEFORE_TAG = new RegExp(`(?:^|[\\s,;])(${NAME}|${PRONOUN})\\s+(?:${VERBS})\\b[^.!?]*?[,:;]?\\s*$`);

const STOP = new Set(
  ("and but then so as when while after before it this that there here what who how why if one no yes oh well now at in on i " +
    "they we you his her its their of to for with from by not nor or yet all some every each once suddenly presently").split(" "),
);

type Part = { type: "q" | "n"; text: string };

export function splitQuotes(p: string): Part[] {
  const parts: Part[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf.trim()) parts.push({ type: "n", text: buf.trim() });
    buf = "";
  };
  while (i < p.length) {
    const ch = p[i];
    if (ch === "“" || ch === '"') {
      const closers = ch === "“" ? ["”", '"'] : ['"', "”"];
      let j = -1;
      for (let k = i + 1; k < p.length; k++) {
        if (closers.includes(p[k])) { j = k; break; }
      }
      flush();
      if (j === -1) { parts.push({ type: "q", text: p.slice(i).trim() }); i = p.length; break; }
      parts.push({ type: "q", text: p.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return parts;
}

function validName(raw: string): boolean {
  const first = raw.replace(/^the /i, "").split(" ")[0].toLowerCase();
  return first.length > 0 && !STOP.has(first);
}

function displayName(raw: string): string {
  const m = raw.trim().match(/^the\s+(.+)$/i);
  return m ? `The ${m[1]}` : raw.trim();
}

const FEMALE_NAMES = new Set(
  "alice dorothy mary anna emma lucy lily sarah jane elizabeth margaret susan kate mira glinda mildred bella eve ada rose clara ella nora ruby grace emily anne".split(" "),
);
const MALE_NAMES = new Set(
  "john tom jack harry peter james william george henry bob charlie paul david arthur frank oscar sam ben max leo".split(" "),
);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Tiny heuristic: title words, a short first-name list, then pronouns right after mentions (narration only). */
function guessGender(name: string, narration: string): GenderHint {
  if (/\b(Mrs|Miss|Ms|Queen|Duchess|Princess|Lady|Witch|Dame|Madam|Mother|Aunt|Mistress)\b/.test(name)) return "female";
  if (/\b(Mr|King|Prince|Lord|Duke|Sir|Wizard|Father|Uncle|Master|Gentleman)\b/.test(name)) return "male";
  const first = name.replace(/^the /i, "").split(" ")[0].toLowerCase();
  if (FEMALE_NAMES.has(first)) return "female";
  if (MALE_NAMES.has(first)) return "male";
  const re = new RegExp(`\\b${esc(name.replace(/^the /i, ""))}\\b`, "gi");
  let f = 0, m = 0, hit: RegExpExecArray | null;
  while ((hit = re.exec(narration))) {
    const win = narration.slice(hit.index + hit[0].length, hit.index + hit[0].length + 70).split(/[.!?\n]/)[0];
    f += (win.match(/\b(she|her|hers|herself)\b/gi) ?? []).length;
    m += (win.match(/\b(he|him|his|himself)\b/gi) ?? []).length;
  }
  return f > m ? "female" : m > f ? "male" : "unknown";
}

function guessAge(name: string, narration: string): AgeHint {
  if (/\b(Queen|King|Duchess|Duke|Mrs|Mr|Professor|Wizard|Witch)\b/.test(name)) return "adult";
  const re = new RegExp(`\\b${esc(name.replace(/^the /i, ""))}\\b`, "gi");
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(narration))) {
    const win = narration.slice(Math.max(0, hit.index - 40), hit.index + hit[0].length + 40);
    if (/\b(little girl|little boy|kitten|baby|small girl)\b/i.test(win)) return "child";
    if (/\b(old|aged|ancient|elderly|grey-haired|white-haired)\b/i.test(win)) return "elder";
  }
  return "unknown";
}

/** Resolve a raw name to an existing/discovered character name when it is a subset of exactly one. */
function canonicalize(raw: string, known: string[]): string {
  const k = nameKey(raw);
  for (const n of known) if (nameKey(n) === k) return n;
  const tokens = k.split(" ");
  const candidates = known.filter((n) => {
    const nt = nameKey(n).split(" ").filter((t) => t !== "of");
    const t2 = tokens.filter((t) => t !== "of");
    return t2.every((t) => nt.includes(t)) || nt.every((t) => t2.includes(t));
  });
  return candidates.length === 1 ? candidates[0] : displayName(raw);
}

export function segmentHeuristic(chunk: string, ctx: HeuristicContext): ChunkResult {
  const known: string[] = ctx.cast.filter((c) => !c.isNarrator).map((c) => c.name);
  const variants = new Map<string, Set<string>>();
  const discovered: string[] = [];
  const history: string[] = [...ctx.recentSpeakers];
  const segments: SegmentDraft[] = [];
  const narration = splitParagraphs(chunk)
    .flatMap((p) => splitQuotes(p).filter((x) => x.type === "n").map((x) => x.text))
    .join("\n");

  const genderOfKnown = (name: string): GenderHint => {
    const c = findCharacter(ctx.cast, name);
    return c ? c.genderHint : guessGender(name, narration);
  };

  const note = (raw: string): string => {
    if (/^(she|he)$/i.test(raw)) {
      const want = raw.toLowerCase() === "she" ? "female" : "male";
      for (let i = history.length - 1; i >= 0; i--) if (genderOfKnown(history[i]) === want) return history[i];
      return "";
    }
    if (!validName(raw)) return "";
    const canon = canonicalize(raw, known);
    if (!known.includes(canon)) { known.push(canon); discovered.push(canon); }
    if (nameKey(raw) !== nameKey(canon)) {
      if (!variants.has(canon)) variants.set(canon, new Set());
      variants.get(canon)!.add(displayName(raw));
    }
    return canon;
  };

  const touch = (name: string) => {
    const i = history.indexOf(name);
    if (i >= 0) history.splice(i, 1);
    history.push(name);
  };

  let prevParaDialogue = false;
  for (const para of splitParagraphs(chunk)) {
    const parts = splitQuotes(para);
    const startsWithQuote = parts[0]?.type === "q";
    let prevSpeaker = "";
    let prevFromAfterTag = false;
    parts.forEach((part, k) => {
      if (part.type === "n") {
        segments.push({ kind: "narration", speaker: NARRATOR_NAME, text: part.text });
        return;
      }
      const after = parts[k + 1]?.type === "n" ? parts[k + 1].text : "";
      const before = parts[k - 1]?.type === "n" ? parts[k - 1].text : "";
      let speaker = "";
      let fromAfter = false;
      const a1 = AFTER_VERB_FIRST.exec(after) ?? AFTER_NAME_FIRST.exec(after);
      if (a1) { speaker = note(a1[1]); fromAfter = !!speaker; }
      if (!speaker && before) {
        const lastSentence = before.split(/(?<=[.!?”"])\s+/).pop() ?? before;
        const b = BEFORE_TAG.exec(lastSentence);
        if (b) speaker = note(b[1]);
      }
      if (!speaker && k > 0 && prevSpeaker && prevFromAfterTag && before.length < 140) speaker = prevSpeaker;
      if (!speaker) {
        const inRun = k > 0 || (startsWithQuote && prevParaDialogue);
        const last = history[history.length - 1];
        if (inRun && history.length >= 2) {
          // turn-taking: the other of the last two distinct speakers
          speaker = history[history.length - 2];
          if (speaker === last) speaker = UNKNOWN_SPEAKER;
        } else speaker = UNKNOWN_SPEAKER;
      }
      if (speaker !== UNKNOWN_SPEAKER) touch(speaker);
      prevSpeaker = speaker;
      prevFromAfterTag = fromAfter;
      segments.push({ kind: "dialogue", speaker, text: part.text });
    });
    prevParaDialogue = startsWithQuote;
  }

  const characters: CharacterHint[] = discovered.map((name) => ({
    name,
    aliases: [...(variants.get(name) ?? [])],
    genderHint: guessGender(name, narration),
    ageHint: guessAge(name, narration),
    personality: "",
  }));
  return { segments, characters };
}
