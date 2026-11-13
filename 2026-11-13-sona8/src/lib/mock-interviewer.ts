import { AREAS, type Area, type ChatMessage } from "./schemas";

export const MOCK_QUESTIONS: Record<Area, string> = {
  trigger: "What usually kicks this process off for you?",
  steps: "Walk me through what you do first, and then what comes next.",
  tools: "Which tools or systems do you use along the way?",
  manual_work: "Which of those steps do you do by hand, and why is that manual?",
  handoffs: "Who do you hand the work to next, and how do you pass it on?",
  exceptions: "What happens when something goes wrong or the case is unusual?",
  pain_points: "What is the most frustrating or slowest part of all this?",
};

export const CLOSING_QUESTION = "Last one: is there anything you would fix tomorrow if you could?";
export const COMPLETE_MESSAGE = "Thank you, that covers everything I needed. The interview is complete, you can press Finish.";
export const MAX_USER_TURNS = 12;

export const OPENING_MESSAGE = (topic: string) =>
  `Hi, thanks for joining. I'd like to understand how this works in practice: ${topic} ${MOCK_QUESTIONS.trigger}`;

function acknowledgement(last: string): string {
  const words = last.trim().split(/\s+/).slice(0, 6).join(" ");
  return words ? `Thanks, so "${words}…" — got it. ` : "Thanks. ";
}

/**
 * Deterministic scripted interviewer: acknowledges the last answer and asks about
 * the first uncovered area, then a closing question, then ends.
 */
export function nextMockReply(history: ChatMessage[], covered: Area[], topic: string): string {
  const userTurns = history.filter((m) => m.role === "user");
  if (userTurns.length === 0) return OPENING_MESSAGE(topic);

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content;
  if (lastAssistant?.endsWith(CLOSING_QUESTION) || lastAssistant === COMPLETE_MESSAGE) return COMPLETE_MESSAGE;

  const ack = acknowledgement(userTurns[userTurns.length - 1].content);
  // Never ask the same bank question twice, even if the keyword heuristic did not tick the area.
  const asked = history.filter((m) => m.role === "assistant").map((m) => m.content);
  const next = AREAS.find((a) => !covered.includes(a) && !asked.some((q) => q.endsWith(MOCK_QUESTIONS[a])));
  if (!next || userTurns.length >= MAX_USER_TURNS) return ack + CLOSING_QUESTION;
  return ack + MOCK_QUESTIONS[next];
}
