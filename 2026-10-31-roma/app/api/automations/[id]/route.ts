import { z } from "zod";
import { eq } from "drizzle-orm";
import { json, body, err } from "@/lib/http";
import { getDb, schema } from "@/lib/db";
import { resolveCron, syncScheduler } from "@/lib/automations";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const find = (id: string) => getDb().select().from(schema.automations).where(eq(schema.automations.id, id)).get();
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!find(id)) return err("Not found", 404);
  const b = await body(req, z.object({ name: z.string().optional(), instruction: z.string().optional(), cron: z.string().optional(), enabled: z.boolean().optional() }));
  if ("res" in b) return b.res;
  const set: Record<string, unknown> = { ...b.data };
  if (b.data.cron) { const c = resolveCron(b.data.cron); if (!c) return err("Invalid cron expression or preset"); set.cron = c; }
  if (Object.keys(set).length) getDb().update(schema.automations).set(set).where(eq(schema.automations.id, id)).run();
  syncScheduler();
  return json(find(id));
}
export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  getDb().delete(schema.automations).where(eq(schema.automations.id, id)).run();
  syncScheduler();
  return json({ ok: true });
}
