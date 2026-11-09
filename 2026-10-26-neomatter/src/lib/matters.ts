import { eq, desc, and } from "drizzle-orm";
import { db, matters, requests, lawyers, events, precedents } from "@/db";
import { runStructured } from "./llm";
import { ClarifyOutput, type ActionBody } from "./schemas";
import { mockClarify } from "./llm/mock";
import { newId } from "./ids";

export function listMatters(filter: { status?: string; owner?: string } = {}) {
  const conds = [];
  if (filter.status) conds.push(eq(matters.status, filter.status));
  if (filter.owner) conds.push(eq(matters.ownerId, filter.owner));
  return db
    .select({ matter: matters, requesterName: requests.requesterName, channel: requests.channel, ownerName: lawyers.name })
    .from(matters)
    .innerJoin(requests, eq(matters.requestId, requests.id))
    .leftJoin(lawyers, eq(matters.ownerId, lawyers.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(matters.updatedAt))
    .all();
}

export function getMatter(id: string) {
  const row = db.select().from(matters).where(eq(matters.id, id)).get();
  if (!row) return null;
  const request = db.select().from(requests).where(eq(requests.id, row.requestId)).get()!;
  const owner = row.ownerId ? db.select().from(lawyers).where(eq(lawyers.id, row.ownerId)).get() ?? null : null;
  const timeline = db.select().from(events).where(eq(events.matterId, id)).orderBy(events.id).all();
  return { matter: row, request, owner, events: timeline };
}

function log(matterId: string, type: string, payload: Record<string, unknown> = {}) {
  db.insert(events).values({ matterId, type, payload, createdAt: Date.now() }).run();
}

export async function applyAction(id: string, a: ActionBody): Promise<{ ok: true } | { ok: false; error: string }> {
  const data = getMatter(id);
  if (!data) return { ok: false, error: "matter not found" };
  const { matter, request } = data;
  const now = Date.now();
  const patch = (v: Partial<typeof matters.$inferInsert>) =>
    db.update(matters).set({ ...v, updatedAt: now }).where(eq(matters.id, id)).run();

  switch (a.action) {
    case "save_reply":
      patch({ draftReply: a.draft_reply });
      log(id, "reply_edited");
      break;
    case "choose_option":
      patch({ chosenOption: a.chosen_option });
      break;
    case "reassign": {
      const l = db.select().from(lawyers).where(eq(lawyers.id, a.owner_id)).get();
      if (!l) return { ok: false, error: "lawyer not found" };
      patch({ ownerId: l.id });
      log(id, "reassigned", { owner_id: l.id, owner: l.name });
      break;
    }
    case "close":
      patch({ status: "closed", waitingOn: null });
      log(id, "closed");
      break;
    case "request_info": {
      const out = await runStructured({
        name: "ClarifyingMessage", schema: ClarifyOutput,
        system: "You are a legal ops assistant. Write a short, polite message to the requester asking for the missing information. Never promise to sign or send anything.",
        prompt: `Requester: ${request.requesterName}\nSubject: ${request.subject}\nMissing info:\n${matter.brief.missing_info.map((m) => `- ${m}`).join("\n") || "(none listed)"}`,
        mock: () => mockClarify(matter.brief.missing_info, request.requesterName),
      });
      patch({ status: "waiting_on_requester", waitingOn: request.requesterName, clarifyingMessage: out.message });
      log(id, "info_requested", { message: out.message });
      break;
    }
    case "approve": {
      const chosen = a.chosen_option ?? matter.chosenOption ?? matter.brief.decision.recommended_label ?? "";
      patch({ status: "approved", waitingOn: null, chosenOption: chosen || null, ...(a.draft_reply ? { draftReply: a.draft_reply } : {}) });
      db.insert(precedents).values({
        id: newId("prec"), matterId: id, practiceArea: matter.practiceArea,
        summary: `${matter.title}. ${matter.summary}`,
        outcome: chosen ? `Approved: ${chosen}` : "Approved and reply marked sent",
        createdAt: now,
      }).run();
      log(id, "approved", { chosen_option: chosen });
      break;
    }
  }
  return { ok: true };
}
