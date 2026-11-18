import { z } from "zod";
import { mockPrecheckAdvice, isMock, structured } from "@/lib/llm";
import { getPermitType } from "@/lib/permits";
import { PRECHECK_SYSTEM } from "@/lib/prompts";
import { runRules } from "@/lib/rules";

const attachment = z.object({
  id: z.string().optional(),
  filename: z.string().optional(),
  kind: z.enum(["site_plan", "floor_plan", "elevations", "other"]),
  text: z.string().optional(),
});
const body = z.object({
  permitType: z.string(),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  attachments: z.array(attachment).default([]),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const permit = getPermitType(parsed.data.permitType);
  if (!permit) return Response.json({ error: "unknown permit type" }, { status: 404 });
  const checks = runRules(
    permit,
    parsed.data.fields,
    parsed.data.attachments.map((a, i) => ({
      id: a.id ?? `a${i}`,
      filename: a.filename ?? "file",
      kind: a.kind,
      text: a.text ?? "",
    })),
  );
  const { advice } = await structured({
    system: PRECHECK_SYSTEM,
    prompt: checks.map((c) => `(${c.status}) ${c.title} [§ ${c.citation}]: ${c.detail}`).join("\n"),
    schema: z.object({ advice: z.string() }),
    mock: () => ({ advice: mockPrecheckAdvice(checks) }),
  });
  return Response.json({ checks, advice, mock: isMock() });
}
