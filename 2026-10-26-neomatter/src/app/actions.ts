"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, playbookClauses } from "@/db";
import { IntakeBody } from "@/lib/schemas";
import { intakeRequest } from "@/lib/triage";
import { applyAction } from "@/lib/matters";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function submitIntake(formData: FormData) {
  const attachmentText = str(formData, "attachment_text");
  const parsed = IntakeBody.safeParse({
    channel: str(formData, "channel"),
    requester_name: str(formData, "requester_name"),
    requester_email: str(formData, "requester_email") || undefined,
    subject: str(formData, "subject"),
    body: str(formData, "body"),
    attachments: attachmentText ? [{ name: str(formData, "attachment_name") || "pasted.txt", text: attachmentText }] : [],
  });
  if (!parsed.success) throw new Error("Please fill in requester, subject and body.");
  const id = await intakeRequest(parsed.data);
  redirect(`/matters/${id}`);
}

export async function matterAction(formData: FormData) {
  const id = str(formData, "id");
  const action = str(formData, "action");
  const input: Record<string, unknown> = { action };
  for (const k of ["chosen_option", "draft_reply", "owner_id"]) {
    const v = formData.get(k);
    if (v !== null && (k === "draft_reply" || String(v).trim())) input[k] = String(v);
  }
  const { ActionBody } = await import("@/lib/schemas");
  const parsed = ActionBody.safeParse(input);
  if (!parsed.success) throw new Error("Invalid action");
  await applyAction(id, parsed.data);
  revalidatePath(`/matters/${id}`);
  revalidatePath("/");
}

export async function saveClause(formData: FormData) {
  const now = Date.now();
  const id = str(formData, "id").toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  if (!id) throw new Error("Clause ID required");
  const values = {
    practiceArea: str(formData, "practice_area") || "general",
    title: str(formData, "title"),
    standardPosition: str(formData, "standard_position"),
    fallbackPosition: str(formData, "fallback_position"),
    walkAway: str(formData, "walk_away"),
    approver: str(formData, "approver"),
    updatedAt: now,
  };
  if (!values.title) throw new Error("Title required");
  db.insert(playbookClauses).values({ id, ...values, createdAt: now })
    .onConflictDoUpdate({ target: playbookClauses.id, set: values }).run();
  revalidatePath("/playbook");
}

export async function deleteClause(formData: FormData) {
  db.delete(playbookClauses).where(eq(playbookClauses.id, str(formData, "id"))).run();
  revalidatePath("/playbook");
}
