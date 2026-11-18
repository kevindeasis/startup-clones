import { reviewApplication } from "@/lib/review";
import { getApplication, saveApplication } from "@/lib/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const app = getApplication((await params).id);
  if (!app) return Response.json({ error: "not found" }, { status: 404 });
  const review = await reviewApplication(app);
  const status = review.recommendation === "request_info" ? "needs_info" : "reviewed";
  saveApplication({ ...app, review, status });
  return Response.json(review);
}
