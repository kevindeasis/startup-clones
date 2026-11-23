"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReextractButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch(`/api/documents/${documentId}/reextract`, { method: "POST" });
      setBusy(false);
      router.refresh();
    }}>{busy ? "Re-extracting..." : "Re-extract"}</button>
  );
}
