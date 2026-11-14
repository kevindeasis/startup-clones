import { AskClient } from "@/components/ask-client";

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  return <AskClient siteId={(await params).id} />;
}
