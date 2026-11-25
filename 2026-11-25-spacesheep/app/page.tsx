import Dashboard from "@/components/Dashboard";
import MockBanner from "@/components/MockBanner";
import { listSpaces, summary } from "@/lib/store";
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <MockBanner />
      <Dashboard initial={listSpaces().map(summary)} />
    </>
  );
}
