import { generateReport } from "@/lib/llm";
import { getApplication, saveApplication } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const app = getApplication((await params).id);
  if (!app) return Response.json({ error: "not found" }, { status: 404 });
  const report = await generateReport(app);
  saveApplication({ ...app, report });
  return Response.json({ report });
}
