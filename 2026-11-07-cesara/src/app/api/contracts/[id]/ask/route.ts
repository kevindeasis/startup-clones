import { askContract } from "@/lib/llm";
import { getContract } from "@/lib/repo";
import { err } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = getContract(id);
  if (!c) return err("Contract not found", 404);
  const body = await req.json().catch(() => null);
  const messages = Array.isArray(body?.messages)
    ? (body.messages as { role: string; content: string }[])
        .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    : [];
  if (!messages.length) return err("messages[] required");
  try {
    return await askContract(messages, c.terms, c.source_text);
  } catch (e) {
    return err(`Ask failed: ${(e as Error).message}`, 502);
  }
}
