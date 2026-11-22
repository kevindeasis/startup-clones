import { ok } from "@/lib/api";
import { readDb } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const db = readDb();
  const accounts = db.accounts.map((a) => ({ ...a, openActions: db.actions.filter((x) => x.accountId === a.id && x.status === "open").length }));
  return ok({ accounts });
}
