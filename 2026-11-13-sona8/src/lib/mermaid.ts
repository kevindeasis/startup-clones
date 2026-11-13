import type { StudySynthesis } from "./schemas";

/** Strip characters that can break Mermaid label syntax and cap the length. */
export function sanitizeLabel(text: string, max = 60): string {
  const clean = text
    .replace(/["'`\[\]{}()<>;|#&\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  return cut || "untitled";
}

const safeId = (prefix: string, raw: string, index: number) =>
  `${prefix}${index}_${raw.replace(/[^A-Za-z0-9]/g, "")}`;

/** Build a `flowchart TD` from the synthesis. Manual steps get the `manual` class, exceptions are diamonds. */
export function buildMermaid(s: StudySynthesis): string {
  const ids = new Map<string, string>();
  const lines = ["flowchart TD"];

  s.mergedSteps.forEach((step, i) => {
    const id = safeId("S", step.id, i);
    ids.set(step.id, id);
    const label = sanitizeLabel(`${step.name} - ${step.actorRole}`);
    lines.push(`  ${id}["${label}"]${step.manual ? ":::manual" : ""}`);
  });

  for (const e of s.edges) {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from || !to) continue;
    lines.push(e.label ? `  ${from} -->|${sanitizeLabel(e.label, 30)}| ${to}` : `  ${from} --> ${to}`);
  }

  const anchor = s.mergedSteps.length ? ids.get(s.mergedSteps[0].id) : undefined;
  s.exceptions.forEach((ex, i) => {
    const id = safeId("X", String(i), i);
    lines.push(`  ${id}{"${sanitizeLabel(ex.condition, 40)}"}`);
    if (anchor) lines.push(`  ${anchor} -.-> ${id}`);
  });

  lines.push("  classDef manual fill:#fde68a,stroke:#b45309,color:#451a03");
  return lines.join("\n");
}
