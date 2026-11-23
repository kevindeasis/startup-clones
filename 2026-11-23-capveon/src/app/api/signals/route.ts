import { handle, json } from "@/lib/http";
import { querySignals } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = (req: Request) =>
  handle(async () => {
    const u = new URL(req.url).searchParams;
    const minFit = u.get("minFit");
    const signals = await querySignals({
      category: u.get("category") || undefined,
      stage: u.get("stage") || undefined,
      agencyId: u.get("agencyId") || undefined,
      minFit: minFit ? Number(minFit) : undefined,
      q: u.get("q") || undefined,
    });
    return json({ signals });
  });
