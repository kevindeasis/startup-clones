import { fail, handle, json, type Ctx } from "@/lib/http";
import { getPursuitDetail } from "@/lib/pursuits";

export const dynamic = "force-dynamic";

export const GET = (_req: Request, { params }: Ctx) =>
  handle(async () => {
    const detail = await getPursuitDetail((await params).id);
    return detail ? json(detail) : fail(404, "Pursuit not found");
  });
