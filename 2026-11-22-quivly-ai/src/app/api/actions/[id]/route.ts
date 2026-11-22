import { fail, ok, parseBody } from "@/lib/api";
import { acceptAction } from "@/lib/projects";
import { actionBody } from "@/lib/schemas";
import { mutate } from "@/lib/store";
import { addDays, today } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, actionBody);
  if ("error" in body) return body.error;
  const res = await mutate((db) => {
    const action = db.actions.find((a) => a.id === id);
    if (!action) return undefined;
    let project;
    if (body.data.op === "accept") project = acceptAction(db, action);
    else if (body.data.op === "snooze") { action.status = "snoozed"; action.snoozedUntil = addDays(today(), 7); }
    else action.status = "dismissed";
    return { action, project };
  });
  return res ? ok(res) : fail("action not found", 404);
}
