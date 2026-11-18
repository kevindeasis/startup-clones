import { permitTypes } from "@/lib/permits";

export function GET() {
  return Response.json(permitTypes);
}
