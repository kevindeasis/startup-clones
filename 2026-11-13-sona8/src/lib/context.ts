import type { Study, StudySynthesis } from "./schemas";

const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "_None recorded._");

/** Markdown document designed to be pasted into another agent's context. */
export function buildContextMarkdown(study: Study, s: StudySynthesis, mermaid: string, interviewCount: number): string {
  const steps = s.mergedSteps
    .map((m, i) => `${i + 1}. **${m.name}** (${m.id}) - owner: ${m.actorRole}; tools: ${m.tools.join(", ") || "none"}; ${m.manual ? "MANUAL" : "automated/assisted"}; mentioned by ${m.mentionedBy}`)
    .join("\n");
  const pains = s.painPoints
    .map((p) => `- [${p.severity}] ${p.description} (x${p.count}; teams: ${p.teams.join(", ") || "n/a"}; sites: ${p.sites.join(", ") || "n/a"}) - "${p.quote}"`)
    .join("\n");
  const recs = s.recommendations
    .map((r) => `- **${r.type}: ${r.title}** - ${r.rationale} (steps: ${r.stepIds.join(", ") || "n/a"})`)
    .join("\n");
  return `# Process context: ${study.title}

## Purpose
This document describes how the process "${study.topic}" actually runs, synthesised from employee interviews. Goal of the study: ${study.goal || "n/a"}. Use it as grounding context when reasoning about, automating or redesigning this process.

${s.headline}

## Process map
\`\`\`mermaid
${mermaid}
\`\`\`

## Steps
${steps || "_None recorded._"}

## Exceptions
${list(s.exceptions.map((e) => `${e.condition} -> ${e.whatHappens} (mentioned by ${e.mentionedBy})`))}

## Pain points
${pains || "_None recorded._"}

## Recommendations
${recs || "_None recorded._"}

## Open questions
${list(s.openQuestions)}

## Provenance
- Interviews synthesised: ${interviewCount}
- Merged steps: ${s.mergedSteps.length}
- Pain points: ${s.painPoints.length}
- Exceptions: ${s.exceptions.length}
- Recommendations: ${s.recommendations.length}
`;
}
