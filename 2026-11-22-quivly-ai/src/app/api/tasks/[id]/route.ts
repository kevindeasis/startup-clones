import { fail, ok, parseBody } from "@/lib/api";
import { taskBody } from "@/lib/schemas";
import { mutate } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseBody(req, taskBody);
  if ("error" in body) return body.error;
  const task = await mutate((db) => {
    const t = db.tasks.find((x) => x.id === id);
    if (t) t.done = body.data.done;
    return t;
  });
  return task ? ok({ task }) : fail("task not found", 404);
}
