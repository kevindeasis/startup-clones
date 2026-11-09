import { z } from "zod";
import { getApplication, setStatus } from "@/lib/repo";
import { handleError, json } from "@/lib/http";
import { STATUSES } from "@/lib/types";

const schema = z.object({ status: z.enum(STATUSES).optional() });

/** Advances to the next status (or to `status` if it is the next step). Expert review / appointment are stubs. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const app = await getApplication(id);
    if (!app) return json({ error: "Not found" }, 404);
    const body = schema.parse(await req.json().catch(() => ({})));
    const cur = STATUSES.indexOf(app.status as (typeof STATUSES)[number]);
    const next = STATUSES[cur + 1];
    if (!next) return json({ error: "Already at the final status." }, 409);
    if (body.status && body.status !== next) return json({ error: `Next status is '${next}'.` }, 409);
    await setStatus(id, next);
    return json({ status: next });
  } catch (e) {
    return handleError(e);
  }
}
