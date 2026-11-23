import { fail, handle, json, readJson, type Ctx } from "@/lib/http";
import { setTaskDone } from "@/lib/pursuits";
import { taskPatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const { done } = taskPatchSchema.parse(await readJson(req));
    const task = await setTaskDone((await params).id, done);
    return task ? json(task) : fail(404, "Task not found");
  });
