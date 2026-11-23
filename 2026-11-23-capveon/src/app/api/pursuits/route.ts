import { agencyMap } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { nextOpenTask } from "@/lib/planner";
import { createPursuit, getPursuitDetail } from "@/lib/pursuits";
import { pursuitInputSchema } from "@/lib/schemas";
import { readCollection } from "@/lib/store";
import type { Pursuit, Task } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = () =>
  handle(async () => {
    const [pursuits, tasks, agencies] = await Promise.all([readCollection<Pursuit>("pursuits"), readCollection<Task>("tasks"), agencyMap()]);
    return json({
      pursuits: pursuits.map((p) => {
        const mine = tasks.filter((t) => t.pursuitId === p.id);
        const next = nextOpenTask(mine);
        return {
          ...p,
          agencyName: agencies.get(p.agencyId)?.name,
          openTasks: mine.filter((t) => !t.done).length,
          nextTask: next ? { title: next.title, dueDate: next.dueDate } : null,
        };
      }),
    });
  });

export const POST = (req: Request) =>
  handle(async () => {
    const input = pursuitInputSchema.parse(await readJson(req));
    const { pursuit, created } = await createPursuit(input);
    const detail = await getPursuitDetail(pursuit.id);
    return json({ ...detail, created }, created ? 201 : 200);
  });
