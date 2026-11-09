import { json } from "@/lib/http";
import { getContext } from "@/lib/ops";
export const dynamic = "force-dynamic";
export async function GET() { return json(getContext()); }
