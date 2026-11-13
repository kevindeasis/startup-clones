import { AREA_LABELS, AREAS, type Area, type InterviewExtraction, type Participant, type Study } from "./schemas";

export const COVERAGE_SYSTEM =
  "You classify which interview areas a participant's message provides information about. Areas: trigger (what starts the workflow), steps (what they do, in order), tools (software/systems used), manual_work (steps done by hand), handoffs (who they pass work to), exceptions (unusual cases, failures), pain_points (frustrations, delays). Return only areas the message clearly addresses.";

export function interviewerSystem(study: Study, p: Participant, covered: Area[], userTurns: number): string {
  const uncovered = AREAS.filter((a) => !covered.includes(a));
  const who = [p.team && `team ${p.team}`, p.site && `site ${p.site}`, p.role && `role ${p.role}`].filter(Boolean).join(", ");
  return `You are an experienced process consultant running a 15-20 minute employee interview about "${study.topic}" for the study "${study.title}". Study goal: ${study.goal || "understand how the work really gets done"}.
Participant: ${who || "unknown context"}.

Rules:
- Ask one question at a time, at most 2 sentences per turn, in plain language.
- Do not ask leading questions. Never give advice or opinions during the interview.
- Follow the participant's thread, but steer toward the uncovered areas: ${uncovered.map((a) => AREA_LABELS[a]).join(", ") || "none"}.
- Use follow-ups like "why is that manual?", "what happens when X goes wrong?", "who do you hand that to?".
- Reply in the participant's language if they write in another language.
- When every area is covered, or after about 12 participant turns (so far: ${userTurns}), ask one closing question ("anything you'd fix tomorrow if you could?") and then say the interview is complete.

Areas already covered: ${covered.map((a) => AREA_LABELS[a]).join(", ") || "none"}.`;
}

export const EXTRACTION_SYSTEM = `You turn an interview transcript into a structured workflow record.
Only include what the participant actually said. Quotes must be verbatim from the participant. Mark a step manual=true only when stated or strongly implied. Step ids are short like s1, s2. relatedStepIds and stepIds must reference step ids. coverage lists the areas the interview touched (trigger, steps, tools, manual_work, handoffs, exceptions, pain_points).`;

export const SYNTHESIS_SYSTEM = `You merge several interview extractions from one study into a single process synthesis.
Merge equivalent steps across interviews and keep mentionedBy counts. Keep the order most participants described. Keep exceptions as branches. Edges must reference mergedSteps ids. Pain points: merge duplicates, count them, list the teams and sites that raised them, and keep one verbatim representative quote. Every recommendation must cite stepIds from mergedSteps. Recommendation types: eliminate, automate, standardise, clarify_owner.`;

export function transcriptText(messages: { role: string; content: string }[]): string {
  return messages.map((m) => `${m.role === "user" ? "Participant" : "Interviewer"}: ${m.content}`).join("\n");
}

export function synthesisPrompt(items: { participant: Participant; extraction: InterviewExtraction }[]): string {
  return items
    .map(
      (i, n) =>
        `### Interview ${n + 1} (team: ${i.participant.team || "?"}, site: ${i.participant.site || "?"}, role: ${i.participant.role || "?"})\n${JSON.stringify(i.extraction)}`,
    )
    .join("\n\n");
}
