import { z } from "zod";
import { getApplication, getTraveller, updateTravellerPassport } from "@/lib/repo";
import { handleError, json } from "@/lib/http";
import { PASSPORT_KEYS, type PassportFields } from "@/lib/types";
import { passportChecks } from "@/lib/rules";
import { getDestination } from "@/lib/destinations";

const schema = z.object({
  passport: z.object(Object.fromEntries(PASSPORT_KEYS.map((k) => [k, z.string().max(200).nullable()])) as Record<(typeof PASSPORT_KEYS)[number], z.ZodNullable<z.ZodString>>).partial(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const t = await getTraveller(id);
    if (!t) return json({ error: "Not found" }, 404);
    const body = schema.parse(await req.json());
    const merged = { ...t.passport, ...body.passport } as PassportFields;
    for (const k of PASSPORT_KEYS) if (merged[k] === "") merged[k] = null;
    await updateTravellerPassport(id, merged);
    const app = await getApplication(t.applicationId);
    const dest = app && getDestination(app.destinationCode);
    const validity = app && dest ? passportChecks(merged, app.departureDate, dest, `Traveller ${t.index}`) : [];
    return json({ id, passport: merged, validity });
  } catch (e) {
    return handleError(e);
  }
}
