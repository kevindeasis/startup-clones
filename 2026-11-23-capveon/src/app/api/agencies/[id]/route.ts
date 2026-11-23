import { agencyDetail } from "@/lib/agencies";
import { fail, handle, json, type Ctx } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const d = await agencyDetail((await params).id);
    return d ? json(d) : fail(404, "Agency not found");
  });
