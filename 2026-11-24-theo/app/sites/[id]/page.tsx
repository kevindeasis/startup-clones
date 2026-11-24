import { notFound } from "next/navigation";
import { readSite } from "@/lib/store";
import Workspace from "./Workspace";
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const site = await readSite((await params).id);
  if (!site) notFound();
  return <Workspace initial={site} />;
}
