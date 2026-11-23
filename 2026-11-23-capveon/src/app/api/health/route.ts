import { handle, json } from "@/lib/http";
import { healthInfo } from "@/lib/health";

export const dynamic = "force-dynamic";

export const GET = () => handle(async () => json(await healthInfo()));
