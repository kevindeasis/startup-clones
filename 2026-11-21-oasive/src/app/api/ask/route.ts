import { z } from "zod";
import { handle, json, mode, readJson } from "@/lib/api";
import { askObligor } from "@/lib/service";

export const dynamic = "force-dynamic";
const body = z.object({
  question: z.string().trim().min(3).max(1000),
  obligorIds: z.array(z.string()).min(1).max(2),
});

export function POST(req: Request) {
  return handle(async () => {
    const { question, obligorIds } = body.parse(await readJson(req));
    const results = await Promise.all(obligorIds.map((id) => askObligor(id, question)));
    return json({ results, mode: mode() });
  });
}
