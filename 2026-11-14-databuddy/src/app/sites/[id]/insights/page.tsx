import { InsightsClient } from "@/components/insights-client";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  return <InsightsClient siteId={(await params).id} />;
}
