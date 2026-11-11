import type { Message, Scenario } from "../schemas";
import { PATTERNS } from "../schemas";

export function partnerSystemPrompt(s: Scenario, focusInstruction: string): string {
  return `You are ${s.character}, ${s.persona}. Scene: ${s.setting}. The other person's goal is: ${s.goal}. Stakes: ${s.stakes}. Stay fully in character. Reply in at most two short sentences, like real speech. React honestly to what they say: warm up when they are clear, specific and confident; get colder, busier or more defensive when they ramble, hedge, over-apologise or make it about themselves. Never coach, never mention that this is practice, never use bullet points. ${focusInstruction}`.trim();
}

export const COACH_SYSTEM =
  "You are a warm but honest conversation coach. You review someone's side of a rehearsed conversation. Be specific, kind and concise. Judge each line by how it would land with the real person in the scene.";

export function feedbackPrompt(s: Scenario, messages: Message[]): string {
  const transcript = messages.map((m) => `[${m.index}] ${m.role === "user" ? "USER" : s.character.toUpperCase()}: ${m.text}`).join("\n");
  return `Scenario: ${s.title}. The user is talking to ${s.character} (${s.persona}). Setting: ${s.setting}. The user's goal: ${s.goal}.

Transcript (bracketed numbers are line indexes):
${transcript}

Return JSON with: score (0-100), summary (exactly 2 sentences), weakest_line_index (index of the weakest USER line), pattern (one of: ${PATTERNS.join(", ")}), and lines: one entry for EVERY USER line with index, verdict (landed | okay | backfired), a one-sentence reason, and a "stronger" rewrite when the verdict is not landed.`;
}

export function drillPrompt(s: Scenario, partnerLine: string, weakLine: string, reason: string, attempt: string): string {
  return `Scenario: ${s.title}. Goal: ${s.goal}.
${s.character} said: "${partnerLine}"
The user originally replied: "${weakLine}"
Why that was weak: ${reason}
The user's new attempt: "${attempt}"

Grade the new attempt. Return JSON: verdict (landed | okay | backfired), note (one or two sentences of coaching), model_answer (a strong reply in the user's voice).`;
}

export function customScenarioPrompt(description: string): string {
  return `The user wants to rehearse this situation: "${description}"

Return JSON describing a scene partner and scenario: title (2-5 words), character (a first name), persona (one line about who they are), setting (where and when), stakes (one line), goal (the user's goal in one line).`;
}
