import { NextResponse } from "next/server";
import { db, genId, getQuestions, now, replaceQuestions } from "@/lib/db";
import { generateGuide } from "@/lib/llm";
import { createStudyBody } from "@/lib/schemas";
import { err } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = db().prepare(`SELECT s.*, (SELECT COUNT(*) FROM interviews i WHERE i.study_id = s.id) AS interview_count
    FROM studies s ORDER BY s.created_at DESC, s.rowid DESC`).all();
  return NextResponse.json({ studies: rows });
}

export async function POST(req: Request) {
  const parsed = createStudyBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err("title, goal and audience are required");
  const { title, goal, audience } = parsed.data;
  const seedsRaw = parsed.data.seed_questions ?? [];
  const seeds = (Array.isArray(seedsRaw) ? seedsRaw : seedsRaw.split("\n")).map((s) => s.trim()).filter(Boolean);
  const questions = await generateGuide(goal, audience, seeds);
  const id = genId();
  db().prepare("INSERT INTO studies (id, title, goal, audience, status, created_at) VALUES (?,?,?,?, 'draft', ?)").run(id, title, goal, audience, now());
  replaceQuestions(id, questions);
  const study = db().prepare("SELECT * FROM studies WHERE id = ?").get(id);
  return NextResponse.json({ ...(study as object), questions: getQuestions(id) }, { status: 201 });
}
