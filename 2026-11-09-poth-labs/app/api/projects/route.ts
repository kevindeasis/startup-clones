import { handle, json } from "@/lib/http";
import { HttpError, createProject, createSampleProject, listProjects } from "@/lib/service";
export const dynamic = "force-dynamic";

export const GET = () => handle(() => listProjects());
export async function POST(req: Request) {
  const b = await json(req);
  return handle(() => {
    if (b.sample) return createSampleProject();
    if (!b.name || !b.question) throw new HttpError(400, "name and question required");
    return { id: createProject(String(b.name), String(b.question)) };
  }, 201);
}
