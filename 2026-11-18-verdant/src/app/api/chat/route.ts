import { z } from "zod";
import type { UIMessage } from "ai";
import { mockDiscoveryAnswer, streamChat } from "@/lib/llm";
import { discoverySystem } from "@/lib/prompts";
import { scorePermitTypes, searchCode } from "@/lib/retrieval";

export const runtime = "nodejs";

const body = z.object({ messages: z.array(z.any()).min(1) });

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return (m.parts ?? [])
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "messages required" }, { status: 400 });
  const messages = parsed.data.messages as UIMessage[];
  const query = lastUserText(messages);
  const sections = searchCode(query, 5);
  const permits = scorePermitTypes(query).slice(0, 3);
  const system = discoverySystem(
    sections,
    permits.map((p) => p.permit),
  );
  return streamChat({
    system,
    messages,
    mockText: mockDiscoveryAnswer(query, sections, permits),
    headers: {
      "x-permit-candidates": JSON.stringify(permits.map((p) => p.permit.id)),
      "x-citations": JSON.stringify(sections.map((s) => s.id)),
    },
  });
}
