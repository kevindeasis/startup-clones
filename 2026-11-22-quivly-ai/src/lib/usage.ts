import type { UsageWeek } from "./types";
import { usageBody, usageRow } from "./schemas";
import { parseCsv } from "./csv";
import { mutate } from "./store";

/** Accepts CSV text or JSON rows; returns validated rows or an error message. */
export function parseUsageInput(raw: string, contentType: string): { rows: ReturnType<typeof usageRow.parse>[] } | { error: string } {
  let candidate: unknown;
  const looksJson = contentType.includes("json") || /^\s*[[{]/.test(raw);
  if (looksJson) {
    try { candidate = JSON.parse(raw); } catch { return { error: "invalid JSON" }; }
  } else candidate = parseCsv(raw);
  const r = usageBody.safeParse(candidate);
  if (!r.success) return { error: "expected columns week_start,active_users,metered_units,tickets_opened: " + r.error.issues[0]?.message };
  return { rows: Array.isArray(r.data) ? r.data : r.data.rows };
}

export async function upsertUsage(accountId: string, rows: ReturnType<typeof usageRow.parse>[]): Promise<number> {
  return mutate((db) => {
    for (const r of rows) {
      const next: UsageWeek = { accountId, weekStart: r.week_start, activeUsers: r.active_users, meteredUnits: r.metered_units, ticketsOpened: r.tickets_opened };
      const i = db.usage.findIndex((u) => u.accountId === accountId && u.weekStart === r.week_start);
      if (i >= 0) db.usage[i] = next; else db.usage.push(next);
    }
    return rows.length;
  });
}
