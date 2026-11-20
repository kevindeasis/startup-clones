import { notFound } from "next/navigation";
import { Workspace } from "@/components/Workspace";
import { getStory } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) notFound();
  const { text: _omit, ...view } = story;
  void _omit;
  return <Workspace initial={view} />;
}
