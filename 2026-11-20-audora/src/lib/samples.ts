import fs from "node:fs";
import path from "node:path";
import { countWords } from "./segmenter/chunk";

type SampleDef = { id: string; title: string; file: string };
const SAMPLES: SampleDef[] = [
  { id: "alice", title: "Alice's Adventures in Wonderland - A Mad Tea-Party (excerpt)", file: "alice.txt" },
  { id: "oz", title: "The Wonderful Wizard of Oz - The Scarecrow and the Tin Woodman (excerpt)", file: "oz.txt" },
];

function read(def: SampleDef): string {
  return fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "samples", def.file), "utf8");
}

export function listSamples(): { id: string; title: string; words: number }[] {
  return SAMPLES.map((s) => ({ id: s.id, title: s.title, words: countWords(read(s)) }));
}

export function getSample(id: string): { title: string; text: string } | null {
  const def = SAMPLES.find((s) => s.id === id);
  return def ? { title: def.title, text: read(def) } : null;
}
