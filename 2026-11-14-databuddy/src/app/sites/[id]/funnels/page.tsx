import { FunnelsClient } from "@/components/funnels-client";

export default async function FunnelsPage({ params }: { params: Promise<{ id: string }> }) {
  return <FunnelsClient siteId={(await params).id} />;
}
