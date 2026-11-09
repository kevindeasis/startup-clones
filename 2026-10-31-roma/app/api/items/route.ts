import { z } from "zod";
import { json, body } from "@/lib/http";
import { createItems, listItems } from "@/lib/ops";
export const dynamic = "force-dynamic";
const itemIn = z.object({
  title: z.string().min(1), kind: z.enum(["task", "note"]).optional(), listId: z.string().optional(),
  body: z.string().optional(), dueDate: z.string().nullable().optional(), dueTime: z.string().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
});
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const inc = u.get("includeDeleted");
  return json({
    items: listItems({
      listId: u.get("listId") || undefined, q: u.get("q") || undefined, changedSince: u.get("changedSince") || undefined,
      includeDeleted: inc === "1" || inc === "true", onlyDeleted: u.get("onlyDeleted") === "1",
    }),
  });
}
export async function POST(req: Request) {
  const b = await body(req, z.union([itemIn, z.array(itemIn).min(1)]));
  if ("res" in b) return b.res;
  const arr = Array.isArray(b.data) ? b.data : [b.data];
  const created = createItems(arr);
  return json(Array.isArray(b.data) ? { items: created } : created[0], 201);
}
