import { listMatters } from "@/lib/matters";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    listMatters().map(({ matter, ownerName, requesterName, channel }) => ({ ...matter, owner: ownerName, requester: requesterName, channel })),
  );
}
