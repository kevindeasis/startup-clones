import type { Severity } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/format";

export function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`badge sev-${s}`}>{s}</span>;
}
export function TypeBadge({ t }: { t: string }) {
  return <span className="badge type">{TYPE_LABEL[t] ?? t}</span>;
}
export function ModeBadge({ mode }: { mode: "mock" | "live" }) {
  return (
    <span className={`badge mode-${mode}`} title="LLM mode" data-testid="mode-badge">
      {mode}
    </span>
  );
}
