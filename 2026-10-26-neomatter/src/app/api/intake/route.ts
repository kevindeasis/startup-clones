import { IntakeBody } from "@/lib/schemas";
import { intakeRequest, runTriage } from "@/lib/triage";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.INTAKE_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-intake-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let json: unknown;
  try { json = await req.json(); } catch { return Response.json({ error: "invalid JSON" }, { status: 400 }); }
  const parsed = IntakeBody.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;

  if (new URL(req.url).searchParams.get("dry_run") === "1") {
    const { brief, retrieved_ids } = await runTriage({
      subject: b.subject, body: b.body, requesterName: b.requester_name, channel: b.channel, attachments: b.attachments ?? [],
    });
    return Response.json({ dry_run: true, brief, retrieved_ids });
  }
  const id = await intakeRequest(b);
  return Response.json({ matter_id: id, url: `/matters/${id}` }, { status: 201 });
}
