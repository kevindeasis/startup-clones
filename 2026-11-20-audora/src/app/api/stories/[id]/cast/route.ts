import { NextResponse } from "next/server";
import { z } from "zod";
import { getStory, saveStory } from "@/lib/store";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  characterId: z.string().min(1),
  voice: z
    .object({
      slot: z.number().int().min(0).max(200).optional(),
      pitch: z.number().min(0.5).max(2).optional(),
      rate: z.number().min(0.5).max(2).optional(),
      preferredVoiceName: z.string().max(200).nullable().optional(),
    })
    .default({}),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body", details: parsed.error.issues }, { status: 400 });
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const ch = story.cast.find((c) => c.id === parsed.data.characterId);
  if (!ch) return NextResponse.json({ error: "Character not found" }, { status: 404 });
  const { voice, name } = parsed.data;
  if (voice.slot !== undefined) ch.voice.slot = voice.slot;
  if (voice.pitch !== undefined) ch.voice.pitch = voice.pitch;
  if (voice.rate !== undefined) ch.voice.rate = voice.rate;
  if (voice.preferredVoiceName !== undefined) {
    if (voice.preferredVoiceName) ch.voice.preferredVoiceName = voice.preferredVoiceName;
    else delete ch.voice.preferredVoiceName;
  }
  if (name && !ch.isNarrator) ch.name = name;
  saveStory(story);
  const { text: _omit, ...view } = story;
  void _omit;
  return NextResponse.json({ story: view });
}
