import { handle, json } from "@/lib/http";
import { postMessage } from "@/lib/service";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const b = await json(req);
  return handle(() => postMessage(token, String(b.content ?? "")));
}
