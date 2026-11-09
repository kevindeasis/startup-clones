import { json, err } from "@/lib/http";
import { resolveApproval } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = resolveApproval((await params).id, "approved");
  if (r.error) return err(r.error, r.error === "not_found" ? 404 : 409);
  return json(r.approval);
}
