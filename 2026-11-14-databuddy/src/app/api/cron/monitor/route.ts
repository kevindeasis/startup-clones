import { fail, json } from "@/lib/http";
import { runMonitor } from "@/lib/monitor";
import { listSites } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || new URL(req.url).searchParams.get("token") !== secret) return fail("Invalid token.", 401);
  const results = [];
  for (const site of listSites()) {
    const insight = await runMonitor(site.id, site.name);
    results.push({ site: site.id, changes: insight.changes.length, sent_to_slack: insight.sent_to_slack });
  }
  return json({ ok: true, results });
}
