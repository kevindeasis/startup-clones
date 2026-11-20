import type { Story } from "./types";

export function toExportJson(story: Pick<Story, "title" | "cast" | "segments">) {
  return { title: story.title, cast: story.cast, segments: story.segments };
}

/** Plain-text screenplay: one `SPEAKER: line` per segment. */
export function toScreenplay(story: Pick<Story, "title" | "cast" | "segments">): string {
  const names = new Map(story.cast.map((c) => [c.id, c.name]));
  const lines = story.segments.map((s) => `${(names.get(s.characterId) ?? "Unknown").toUpperCase()}: ${s.text.replace(/\s*\n\s*/g, " ")}`);
  return `${story.title}\n\n${lines.join("\n\n")}\n`;
}

export function fileSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "story";
}
