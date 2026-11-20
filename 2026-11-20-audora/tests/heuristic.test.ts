import { describe, expect, it } from "vitest";
import { segmentHeuristic } from "@/lib/segmenter/heuristic";
import { createNarrator } from "@/lib/segmenter/cast";

const ctx = () => ({ cast: [createNarrator()], recentSpeakers: [] as string[] });
const dialogue = (r: ReturnType<typeof segmentHeuristic>) => r.segments.filter((s) => s.kind === "dialogue");

describe("heuristic attribution", () => {
  it('handles "…," said X', () => {
    const r = segmentHeuristic(`“I am late,” said Alice. She ran.`, ctx());
    expect(dialogue(r)[0]).toMatchObject({ speaker: "Alice", text: "“I am late,”" });
    expect(r.segments.find((s) => s.text.startsWith("said"))?.kind).toBe("narration");
  });

  it('handles "…" X said', () => {
    const r = segmentHeuristic(`"Come along," the Scarecrow said heartily.`, ctx());
    expect(dialogue(r)[0].speaker).toBe("The Scarecrow");
  });

  it('handles X said, "…"', () => {
    const r = segmentHeuristic(`The Hatter said, “Why is a raven like a writing-desk?”`, ctx());
    expect(dialogue(r)[0].speaker).toBe("The Hatter");
  });

  it('handles "…," X asked/replied and "…" X [verb]ed', () => {
    const r = segmentHeuristic(`"Who are you?" Dorothy asked.\n\n"Nobody," Toto replied.\n\n"Go away" Bella grumbled.`, ctx());
    expect(dialogue(r).map((s) => s.speaker)).toEqual(["Dorothy", "Toto", "Bella"]);
  });

  it("alternates between the last two speakers for untagged turns", () => {
    const text = [`"Hello," said Alice.`, `"Hi," said Bob.`, `"How are you?"`, `"Fine."`, `"Good."`].join("\n\n");
    const speakers = dialogue(segmentHeuristic(text, ctx())).map((s) => s.speaker);
    expect(speakers).toEqual(["Alice", "Bob", "Alice", "Bob", "Alice"]);
  });

  it("falls back to Unknown Speaker and keeps text verbatim", () => {
    const text = `"Who goes there?"`;
    const r = segmentHeuristic(text, ctx());
    expect(dialogue(r)[0].speaker).toBe("Unknown Speaker");
    expect(r.segments.map((s) => s.text).join(" ")).toBe(text);
  });

  it("splits a paragraph with two quotes by the same speaker", () => {
    const r = segmentHeuristic(`“I wish,” said Alice, “I could go.”`, ctx());
    expect(dialogue(r).map((s) => s.speaker)).toEqual(["Alice", "Alice"]);
  });

  it("infers gender hints from titles and pronouns", () => {
    const r = segmentHeuristic(`"Off with her head!" cried the Queen. Alice said, "No." She curtsied.`, ctx());
    const q = r.characters.find((c) => c.name === "The Queen");
    expect(q?.genderHint).toBe("female");
  });
});
