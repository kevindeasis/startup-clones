import { notFound } from "next/navigation";
import Viewer from "@/components/Viewer";
import MockBanner from "@/components/MockBanner";
import { currentVersion, findSpace } from "@/lib/store";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = findSpace((await params).slug);
  return { title: s ? `${s.title} - Paddock` : "Not found" };
}

export default async function SpacePage({ params }: { params: Promise<{ slug: string }> }) {
  const s = findSpace((await params).slug);
  if (!s) notFound();
  return (
    <>
      <MockBanner />
      <Viewer id={s.id} slug={s.slug} initialTitle={s.title} initialVisibility={s.visibility} initialVersion={currentVersion(s).n} />
    </>
  );
}
