import { json, parseBody } from "../../../lib/http";
import * as repo from "../../../lib/repo";
import { CreateStudyBody } from "../../../lib/schemas";

export const dynamic = "force-dynamic";

export function GET() {
  return json(repo.listStudies());
}

export async function POST(req: Request) {
  const body = await parseBody(req, CreateStudyBody);
  if ("error" in body) return body.error;
  return json(repo.createStudy(body.data), 201);
}
