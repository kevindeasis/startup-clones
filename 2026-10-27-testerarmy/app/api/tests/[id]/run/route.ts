import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createRun, enqueueRun } from '@/lib/agent/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db.data.tests.find((t) => t.id === id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const run = await createRun(id);
  enqueueRun(run.id);
  return NextResponse.json({ runId: run.id }, { status: 202 });
}
