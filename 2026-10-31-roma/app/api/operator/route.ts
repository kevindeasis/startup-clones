import { z } from "zod";
import { json, body } from "@/lib/http";
import { getHistory, runOperator, isMock } from "@/lib/operator";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get("itemId") || undefined;
  return json({ mock: isMock(), messages: getHistory(itemId) });
}
export async function POST(req: Request) {
  const b = await body(req, z.object({ message: z.string().min(1), itemId: z.string().optional() }));
  if ("res" in b) return b.res;
  return json(await runOperator({ message: b.data.message, itemId: b.data.itemId }));
}
