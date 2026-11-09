import { z } from "zod";
import { getDestination, NATIONALITIES } from "@/lib/destinations";
import { createApplication } from "@/lib/repo";
import { handleError, json } from "@/lib/http";
import { parseISO } from "@/lib/dates";

const isoDate = z.string().refine((s) => parseISO(s) !== null, "Expected YYYY-MM-DD");
const schema = z.object({
  destinationCode: z.string().refine((c) => !!getDestination(c), "Unknown destination"),
  nationality: z.string().default("EG").refine((c) => NATIONALITIES.some((n) => n.code === c), "Unsupported nationality"),
  purpose: z.string().default("tourism"),
  departureDate: isoDate,
  returnDate: isoDate,
  travellerCount: z.number().int().min(1).max(5),
}).refine((v) => parseISO(v.returnDate)! > parseISO(v.departureDate)!, { message: "returnDate must be after departureDate", path: ["returnDate"] });

export async function POST(req: Request) {
  try {
    const body = schema.parse(await req.json());
    const row = await createApplication({ ...body, destinationCode: body.destinationCode.toUpperCase() });
    return json({ id: row.id, application: row }, 201);
  } catch (e) {
    return handleError(e);
  }
}
