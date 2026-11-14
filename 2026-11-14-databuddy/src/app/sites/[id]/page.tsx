import { Dashboard } from "@/components/dashboard";

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  return <Dashboard siteId={(await params).id} />;
}
