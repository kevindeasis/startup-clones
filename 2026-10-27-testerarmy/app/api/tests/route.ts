import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { nanoid } from '@/lib/agent/id';
import { parseTestInput } from '@/lib/validate';
import type { Test } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = await getDb();
  return NextResponse.json(db.data.tests);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseTestInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const db = await getDb();
  const now = new Date().toISOString();
  const test: Test = { id: nanoid(), ...parsed.value, createdAt: now, updatedAt: now };
  db.data.tests.push(test);
  await db.write();
  return NextResponse.json(test, { status: 201 });
}
