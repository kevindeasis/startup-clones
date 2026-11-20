import { NextResponse } from "next/server";
import { z } from "zod";
import { checkText, firstLineTitle, ImportError, importFromUrl } from "@/lib/importer";
import { resolveMode } from "@/lib/llm-mode";
import { getSample } from "@/lib/samples";
import { countWords } from "@/lib/segmenter/chunk";
import { createNarrator } from "@/lib/segmenter/cast";
import { listStories, newId, saveStory } from "@/lib/store";
import type { Story } from "@/lib/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  sampleId: z.string().optional(),
});

export async function GET() {
  return NextResponse.json({ stories: listStories() });
}

export async function POST(req: Request) {
  try {
    let title = "";
    let text = "";
    let source: Story["source"] = { kind: "paste" };
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      title = String(form.get("title") ?? "").trim();
      if (!(file instanceof File)) throw new ImportError("No file was uploaded.");
      if (file.size > 2 * 1024 * 1024) throw new ImportError("The file is larger than the 2 MB limit.");
      if (!/\.(txt|md|markdown)$/i.test(file.name) && !file.type.startsWith("text/")) {
        throw new ImportError("Only .txt and .md files are supported.");
      }
      text = await file.text();
      source = { kind: "file", filename: file.name };
      if (!title) title = file.name.replace(/\.[^.]+$/, "");
    } else {
      const parsed = bodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) throw new ImportError("Invalid request body.");
      const b = parsed.data;
      title = (b.title ?? "").trim();
      if (b.sampleId) {
        const sample = getSample(b.sampleId);
        if (!sample) throw new ImportError(`Unknown sample "${b.sampleId}".`);
        text = sample.text;
        source = { kind: "sample" };
        title = title || sample.title;
      } else if (b.url?.trim()) {
        const imported = await importFromUrl(b.url.trim());
        text = imported.text;
        source = { kind: "url", url: imported.url };
        title = title || imported.title;
      } else if (b.text?.trim()) {
        text = b.text;
      } else {
        throw new ImportError("Provide text, a url, a file or a sampleId.");
      }
    }
    text = checkText(text);
    const now = new Date().toISOString();
    const story: Story = {
      id: newId(), title: title || firstLineTitle(text), source, text, wordCount: countWords(text),
      status: "imported", chunksTotal: 0, chunksDone: 0, mode: resolveMode(),
      cast: [createNarrator()], segments: [], createdAt: now, updatedAt: now,
    };
    saveStory(story);
    const { text: _omit, ...view } = story;
    void _omit;
    return NextResponse.json({ story: view }, { status: 201 });
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}
