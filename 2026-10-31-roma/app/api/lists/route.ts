import { z } from "zod";
import { json, body } from "@/lib/http";
import { createList, getLists } from "@/lib/ops";
export const dynamic = "force-dynamic";
export const fieldDef = z.object({ name: z.string().min(1), type: z.string().optional() });
export async function GET() { return json({ lists: getLists() }); }
export async function POST(req: Request) {
  const b = await body(req, z.object({ name: z.string().min(1), kind: z.enum(["custom", "tasks", "notes"]).optional(), fields: z.array(fieldDef).optional() }));
  if ("res" in b) return b.res;
  return json(createList(b.data), 201);
}
