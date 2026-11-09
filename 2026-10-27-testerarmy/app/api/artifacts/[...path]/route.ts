import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { dataDir } from '@/lib/db';
import { resolveArtifact } from '@/lib/artifact-path';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await params;
  const r = resolveArtifact(dataDir(), segs);
  if (!r || !fs.existsSync(r.file)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const buf = fs.readFileSync(r.file);
  const range = req.headers.get('range');
  if (range && r.type === 'video/webm') {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1]) : 0;
      const end = m[2] ? Math.min(parseInt(m[2]), buf.length - 1) : buf.length - 1;
      return new NextResponse(new Uint8Array(buf.subarray(start, end + 1)), {
        status: 206,
        headers: {
          'Content-Type': r.type,
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
        },
      });
    }
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'Content-Type': r.type, 'Content-Length': String(buf.length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' },
  });
}
