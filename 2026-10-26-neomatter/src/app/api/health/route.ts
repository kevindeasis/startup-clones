import { llmMode } from "@/lib/llm";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, llm: llmMode() });
}
