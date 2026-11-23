import { handle, json, type Ctx } from "@/lib/http";
import { draftForPursuit } from "@/lib/pursuits";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = (_req: Request, { params }: Ctx) =>
  handle(async () => json(await draftForPursuit((await params).id), 201));
