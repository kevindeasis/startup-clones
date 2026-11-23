import MiniSearch from "minisearch";
import { agencyMap, listSignals } from "./data";
import { fitBand } from "./fit";
import { compareSignals } from "./stages";
import type { Signal } from "./types";

export interface SignalFilters {
  category?: string;
  stage?: string;
  agencyId?: string;
  minFit?: number;
  q?: string;
}

export type SignalView = Signal & { agencyName: string; band: "strong" | "possible" | "weak" };

export async function querySignals(f: SignalFilters): Promise<SignalView[]> {
  const agencies = await agencyMap();
  let signals = (await listSignals()).map((s) => ({
    ...s,
    agencyName: agencies.get(s.agencyId)?.name ?? s.agencyId,
    band: fitBand(s.fitScore),
  }));
  if (f.category) signals = signals.filter((s) => s.category === f.category);
  if (f.stage) signals = signals.filter((s) => s.stage === f.stage);
  if (f.agencyId) signals = signals.filter((s) => s.agencyId === f.agencyId);
  if (f.minFit !== undefined && !Number.isNaN(f.minFit)) signals = signals.filter((s) => s.fitScore >= f.minFit!);
  if (f.q && f.q.trim()) {
    const ms = new MiniSearch<SignalView & { evidence: string }>({
      fields: ["projectTitle", "agencyName", "evidence"],
      idField: "id",
      searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" },
    });
    ms.addAll(signals.map((s) => ({ ...s, evidence: s.sources.map((x) => x.quote).join(" ") })));
    const ids = new Set(ms.search(f.q).map((r) => r.id as string));
    signals = signals.filter((s) => ids.has(s.id));
  }
  return signals.sort(compareSignals);
}
