import { notFound } from "next/navigation";
import { MockBanner } from "@/components/ui";
import { SiteNav } from "@/components/site-nav";
import { isMockMode } from "@/lib/llm";
import { getSite } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = getSite(id);
  if (!site) notFound();
  return (
    <div>
      {isMockMode() && <MockBanner />}
      <SiteNav id={site.id} name={site.name} />
      {children}
    </div>
  );
}
