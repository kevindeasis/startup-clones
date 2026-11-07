import {
  addMessage, completeInterview, getMessages, getQuestions, getStudy,
  type Interview,
} from "./db";
import { greeting, interviewerTurn, THANKS, type Turn } from "./llm";

export type StepResult = { message: string | null; done: boolean };

/** Advance an interview by one assistant turn. `content` is the participant's message (empty on first call). */
export async function step(iv: Interview, content: string): Promise<StepResult> {
  if (iv.status === "complete") return { message: null, done: true };
  const study = getStudy(iv.study_id)!;
  const questions = getQuestions(iv.study_id).map((q) => q.text);
  let msgs = getMessages(iv.id);

  if (msgs.length === 0) {
    const text = await greeting({ title: study.title, goal: study.goal, questions });
    addMessage(iv.id, "assistant", text, "question");
    return { message: text, done: false };
  }
  if (content.trim()) {
    addMessage(iv.id, "user", content.trim());
    msgs = getMessages(iv.id);
  } else if (msgs[msgs.length - 1].role === "assistant") {
    // Nothing new from the participant: replay the pending assistant message.
    return { message: msgs[msgs.length - 1].content, done: false };
  }

  const askedCount = msgs.filter((m) => m.kind === "question").length;
  const lastAsst = [...msgs].reverse().find((m) => m.role === "assistant");
  const followedUp = lastAsst?.kind === "followup";
  const transcript: Turn[] = msgs.map((m) => ({ role: m.role, content: m.content }));
  const r = await interviewerTurn({ title: study.title, goal: study.goal, questions, transcript, askedCount, followedUp });
  if (r.done) {
    addMessage(iv.id, "assistant", THANKS, "closing");
    completeInterview(iv.id);
    return { message: THANKS, done: true };
  }
  addMessage(iv.id, "assistant", r.text, r.kind);
  return { message: r.text, done: false };
}

/** Force-close an interview (used when the synthetic loop hits its turn cap). */
export function forceClose(iv: Interview) {
  addMessage(iv.id, "assistant", THANKS, "closing");
  completeInterview(iv.id);
}
