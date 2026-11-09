import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const r = db.data.runs.find((x) => x.id === id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
