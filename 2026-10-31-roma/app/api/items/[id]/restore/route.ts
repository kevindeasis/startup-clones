import { json, err } from "@/lib/http";
import { getItem, restoreItem } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getItem(id)) return err("Not found", 404);
  return json(restoreItem(id));
}
