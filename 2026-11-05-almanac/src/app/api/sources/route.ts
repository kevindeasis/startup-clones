import { NextResponse } from "next/server";
import { z } from "zod";
import { addSource, deleteSource, getSource, listSources } from "@/lib/store";
import { ingestText } from "@/lib/brain/ingest";

export const dynamic = "force-dynamic";

const Body = z.object({
  title: z.string().min(1),
  kind: z.enum(["markdown", "text", "email", "meeting", "slack", "csv"]),
  text: z.string().min(1),
});

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = getSource(Number(id));
    return s ? NextResponse.json(s) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(listSources().map(({ text, ...s }) => ({ ...s, chars: text.length })));
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File);
    if (!files.length) return NextResponse.json({ error: "no file" }, { status: 400 });
    const out = [];
    for (const f of files) out.push(ingestText(f.name, await f.text()));
    return NextResponse.json(out.length === 1 ? out[0] : out, { status: 201 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json(addSource(parsed.data), { status: 201 });
}

export async function DELETE(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id || !deleteSource(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
