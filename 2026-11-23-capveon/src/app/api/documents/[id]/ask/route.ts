import { fail, handle, json, readJson, type Ctx } from "@/lib/http";
import { askDocument } from "@/lib/qa";
import { askInputSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

async function run(id: string, question: unknown) {
  const { question: q } = askInputSchema.parse({ question });
  const res = await askDocument(id, q);
  return res ? json(res) : fail(404, "Document not found");
}

export const GET = (req: Request, { params }: Ctx) =>
  handle(async () => run((await params).id, new URL(req.url).searchParams.get("question") ?? ""));

export const POST = (req: Request, { params }: Ctx) =>
  handle(async () => {
    const body = (await readJson(req)) as { question?: unknown };
    return run((await params).id, body.question);
  });
