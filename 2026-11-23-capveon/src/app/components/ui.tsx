import Link from "next/link";
import type { FitBand } from "@/lib/fit";

export const CATEGORY_LABEL: Record<string, string> = {
  water: "Water",
  wastewater: "Wastewater",
  stormwater: "Stormwater",
  roads_bridges: "Roads & bridges",
  buildings: "Buildings",
  energy: "Energy",
  industrial: "Industrial",
  it_telecom: "IT / telecom",
};

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>;
}

export function Fit({ score, band }: { score: number; band: FitBand }) {
  return (
    <div className={`fit ${band}`}>
      {score}
      <small>{band} fit</small>
    </div>
  );
}

export function DocLink({ id, page, children }: { id: string; page?: number; children: React.ReactNode }) {
  return <Link href={page ? `/documents/${id}?page=${page}` : `/documents/${id}`}>{children}</Link>;
}

export function money(n?: number): string {
  if (n === undefined || n === null) return "not stated";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M` : `$${n.toLocaleString("en-US")}`;
}
