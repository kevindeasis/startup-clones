import { handle, json } from "@/lib/http";
import { agencySummaries } from "@/lib/agencies";

export const dynamic = "force-dynamic";

export const GET = () => handle(async () => json({ agencies: await agencySummaries() }));
