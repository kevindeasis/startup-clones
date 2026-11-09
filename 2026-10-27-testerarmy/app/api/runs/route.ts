import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const testId = new URL(req.url).searchParams.get('testId');
  const db = await getDb();
  const runs = db.data.runs.filter((r) => !testId || r.testId === testId).slice().reverse();
  return NextResponse.json(runs);
}
