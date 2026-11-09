import { eq } from "drizzle-orm";
import { db, lawyers, requests, matters, events } from "@/db";
import { TriageOutput, type IntakeBody } from "./schemas";
import { runStructured } from "./llm";
import { mockTriage, type ContextItem, type MockInput } from "./llm/mock";
import { retrieve } from "./retrieval";
import { newId } from "./ids";

const SYSTEM = `You are a senior in-house legal operations assistant. Triage the incoming legal request.
Rules:
- Only cite IDs that appear in the provided context block. If nothing relevant is retrieved, say so in missing_info.
- Never claim to have sent, signed or approved anything. The draft reply must be addressed to the requester, <=180 words, and never promise to sign or send.
- Produce redline rows only against attached text; use an empty array if there is no attachment.
- Set decision_required false (and empty options) when no decision is needed.
- Be concise.`;

function formatContext(ctx: ContextItem[]): string {
  if (!ctx.length) return "(no relevant context retrieved)";
  return ctx.map((c, i) => `[${i + 1}] ${c.id} (${c.kind}, ${c.practiceArea}): ${c.text}`).join("\n");
}

export type TriageResult = { brief: TriageOutput; retrieved_ids: string[] };

export async function runTriage(input: {
  subject: string; body: string; requesterName: string; channel: string;
  attachments: { name: string; text: string }[];
}): Promise<TriageResult> {
  const attText = input.attachments.map((a) => a.text).join("\n").slice(0, 2000);
  const context = retrieve(`${input.subject} ${input.body} ${attText}`, 6, 3);
  const mockInput: MockInput = { ...input, context };
  const prompt = `Channel: ${input.channel}\nRequester: ${input.requesterName}\nSubject: ${input.subject}\n\nBody:\n${input.body}\n\nAttachments:\n${
    input.attachments.map((a) => `--- ${a.name} ---\n${a.text}`).join("\n") || "(none)"
  }\n\nRetrieved context (playbook clauses and precedents):\n${formatContext(context)}`;

  const allowed = new Set(context.map((c) => c.id));
  try {
    const brief = await runStructured({
      name: "TriageOutput", schema: TriageOutput, system: SYSTEM, prompt, mock: () => mockTriage(mockInput),
    });
    // Guard: drop citations that were not in the retrieved context.
    const clean = (ids: string[]) => ids.filter((i) => allowed.has(i));
    brief.redline.forEach((r) => (r.citations = clean(r.citations)));
    brief.decision.options.forEach((o) => (o.citations = clean(o.citations)));
    brief.citations_used = clean(brief.citations_used);
    return { brief, retrieved_ids: context.map((c) => c.id) };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 200) : String(e);
    const brief: TriageOutput = {
      title: input.subject, summary: "Automatic triage failed; please review manually.", practice_area: "general",
      urgency: "P2", urgency_reason: "Unknown", ask: input.subject, missing_info: [`Triage failed: ${msg}`],
      key_terms: [], dates: [], decision_required: false,
      decision: { question: "", options: [], recommended_label: "" }, redline: [],
      draft_reply: `Hi ${input.requesterName.split(" ")[0]},\n\nThanks for your request. A lawyer will review it shortly.`,
      citations_used: [],
    };
    return { brief, retrieved_ids: context.map((c) => c.id) };
  }
}

export function routeOwner(area: string): string | null {
  const all = db.select().from(lawyers).all();
  return (all.find((l) => l.practiceAreas.includes(area)) ?? all.find((l) => l.isDefault === 1) ?? all[0])?.id ?? null;
}

/** Store the request, triage it, create the matter. Returns the new matter id. */
export async function intakeRequest(body: IntakeBody, receivedAt = Date.now()): Promise<string> {
  const requestId = newId("req");
  db.insert(requests).values({
    id: requestId, channel: body.channel, requesterName: body.requester_name,
    requesterEmail: body.requester_email ?? null, subject: body.subject, body: body.body,
    attachments: body.attachments ?? [], receivedAt,
  }).run();
  return triageRequest(requestId);
}

export async function triageRequest(requestId: string): Promise<string> {
  const req = db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!req) throw new Error(`request ${requestId} not found`);
  const { brief, retrieved_ids } = await runTriage({
    subject: req.subject, body: req.body, requesterName: req.requesterName, channel: req.channel, attachments: req.attachments,
  });
  const now = Date.now();
  const matterId = newId("mat");
  const ownerId = routeOwner(brief.practice_area);
  db.insert(matters).values({
    id: matterId, requestId, title: brief.title, summary: brief.summary, practiceArea: brief.practice_area,
    urgency: brief.urgency, status: "in_review", ownerId, waitingOn: "Legal review", brief,
    draftReply: brief.draft_reply, chosenOption: null, clarifyingMessage: null, createdAt: now, updatedAt: now,
  }).run();
  db.insert(events).values([
    { matterId, type: "created", payload: { request_id: requestId, channel: req.channel }, createdAt: now },
    { matterId, type: "triaged", payload: { owner_id: ownerId, retrieved_ids, citations_used: brief.citations_used }, createdAt: now },
  ]).run();
  return matterId;
}
