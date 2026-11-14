import { headers } from "next/headers";
import { SetupClient } from "@/components/setup-client";

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return <SetupClient siteId={(await params).id} origin={`${proto}://${host}`} />;
}
