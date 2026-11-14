import type { Range } from "./types";
import { RANGES } from "./types";

export type RangeWindow = { range: Range; from: string; to: string; bucket: "hour" | "day" };

const MS: Record<Range, number> = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

export function parseRange(value: string | null | undefined): Range {
  return (RANGES as readonly string[]).includes(value ?? "") ? (value as Range) : "30d";
}

export function windowFor(range: Range, now = new Date()): RangeWindow {
  return {
    range,
    from: new Date(now.getTime() - MS[range]).toISOString(),
    to: now.toISOString(),
    bucket: range === "24h" ? "hour" : "day",
  };
}
