import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const t = db.data.tests.find((x) => x.id === id);
  return t ? NextResponse.json(t) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const before = db.data.tests.length;
  db.data.tests = db.data.tests.filter((x) => x.id !== id);
  if (db.data.tests.length === before) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await db.write();
  return NextResponse.json({ ok: true });
}
