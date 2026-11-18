import { z } from "zod";
import { getPermitType } from "@/lib/permits";
import { listApplications, nextId, saveApplication } from "@/lib/store";
import type { Application } from "@/lib/types";

const body = z.object({
  permitType: z.string(),
  applicant: z.object({ name: z.string().min(1), email: z.string().min(3), phone: z.string().optional() }),
  address: z.string().min(1),
  parcel: z.string().optional(),
  zoning: z.enum(["R-1", "R-2", "C-1"]).default("R-1"),
  projectDescription: z.string().min(1),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        filename: z.string(),
        kind: z.enum(["site_plan", "floor_plan", "elevations", "other"]),
        text: z.string().default(""),
        pages: z.number().optional(),
      }),
    )
    .default([]),
});

export function GET() {
  return Response.json(listApplications());
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.message }, { status: 400 });
  const d = parsed.data;
  if (!getPermitType(d.permitType)) return Response.json({ error: "unknown permit type" }, { status: 400 });
  const now = new Date().toISOString();
  const app: Application = {
    ...d,
    id: nextId(),
    status: "submitted",
    attachments: d.attachments.map((a, i) => ({ ...a, id: a.id ?? `att-${Date.now()}-${i}` })),
    createdAt: now,
    updatedAt: now,
  };
  return Response.json(saveApplication(app), { status: 201 });
}
