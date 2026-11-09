import { isMock } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, mock: isMock() });
}
