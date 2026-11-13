import { streamText } from "ai";
import { classifyCoverage } from "./coverage";
import { getModel, isMockMode } from "./llm";
import { nextMockReply, OPENING_MESSAGE } from "./mock-interviewer";
import { interviewerSystem } from "./prompts";
import * as repo from "./repo";
import type { ChatMessage, Participant, Study } from "./schemas";

/** Persist the agent's opening message the first time an interview is opened. */
export function ensureOpening(p: Participant, study: Study): void {
  if (repo.getMessages(p.id).length === 0) repo.addMessage(p.id, "assistant", OPENING_MESSAGE(study.topic));
}

/** Stream the reply as plain text; the full text is persisted once the stream ends. */
export function replyResponse(p: Participant, study: Study, history: ChatMessage[], headers: HeadersInit): Response {
  const userTurns = history.filter((m) => m.role === "user").length;
  const save = (text: string) => repo.addMessage(p.id, "assistant", text);

  if (isMockMode()) {
    const text = nextMockReply(history, repo.getCoverage(p.id), study.topic);
    save(text);
    const encoder = new TextEncoder();
    const words = text.split(/(\s+)/);
    const stream = new ReadableStream({
      async start(controller) {
        for (const w of words) {
          controller.enqueue(encoder.encode(w));
          await new Promise((r) => setTimeout(r, 15));
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
  }

  const result = streamText({
    model: getModel(),
    system: interviewerSystem(study, p, repo.getCoverage(p.id), userTurns),
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    onFinish: ({ text }) => save(text),
  });
  return result.toTextStreamResponse({ headers });
}

/** Record the participant's message, update coverage and return the covered areas. */
export async function recordUserTurn(p: Participant, message: string) {
  if (p.status === "invited") repo.setStatus(p.id, "in_progress");
  repo.addMessage(p.id, "user", message);
  const fresh = await classifyCoverage(message, repo.getCoverage(p.id));
  return repo.unionCoverage(p.id, fresh);
}
