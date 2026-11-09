import { z } from "zod";
import { nanoid } from "nanoid";
import { json, body, err } from "@/lib/http";
import { getDb, schema } from "@/lib/db";
import { resolveCron, syncScheduler } from "@/lib/automations";
export const dynamic = "force-dynamic";
export async function GET() { return json({ automations: getDb().select().from(schema.automations).orderBy(schema.automations.createdAt).all() }); }
export async function POST(req: Request) {
  const b = await body(req, z.object({ name: z.string().min(1), instruction: z.string().min(1), cron: z.string().min(1), enabled: z.boolean().optional() }));
  if ("res" in b) return b.res;
  const cron = resolveCron(b.data.cron);
  if (!cron) return err("Invalid cron expression or preset");
  const id = nanoid(10);
  getDb().insert(schema.automations).values({ id, name: b.data.name, instruction: b.data.instruction, cron, enabled: b.data.enabled ?? true, lastRunAt: null, createdAt: new Date().toISOString() }).run();
  syncScheduler();
  return json(getDb().select().from(schema.automations).all().find((a) => a.id === id), 201);
}
