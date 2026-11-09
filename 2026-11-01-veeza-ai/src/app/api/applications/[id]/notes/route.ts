import { z } from "zod";
import { addNote, getApplication } from "@/lib/repo";
import { handleError, json } from "@/lib/http";

const schema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!(await getApplication(id))) return json({ error: "Not found" }, 404);
    const { text } = schema.parse(await req.json());
    return json({ notes: await addNote(id, text) }, 201);
  } catch (e) {
    return handleError(e);
  }
}
