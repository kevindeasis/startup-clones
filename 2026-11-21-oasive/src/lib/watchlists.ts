import type { Watchlist } from "./types";

export type WatchlistPatch = { name?: string; add?: string[]; remove?: string[] };

/** Pure patch application: dedupes adds, ignores unknown obligor ids, removes after adds. */
export function applyWatchlistPatch(wl: Watchlist, patch: WatchlistPatch, validIds: string[]): Watchlist {
  const ids = new Set(wl.obligorIds);
  for (const id of patch.add ?? []) if (validIds.includes(id)) ids.add(id);
  for (const id of patch.remove ?? []) ids.delete(id);
  return { ...wl, name: patch.name?.trim() || wl.name, obligorIds: Array.from(ids) };
}

export const DEFAULT_WATCHLIST_ID = "default";
