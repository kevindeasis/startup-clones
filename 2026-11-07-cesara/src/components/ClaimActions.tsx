"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800",
  appealed: "bg-blue-100 text-blue-800",
  recovered: "bg-emerald-100 text-emerald-800",
  closed: "bg-slate-200 text-slate-700",
};

export default function ClaimActions({
  rowId,
  initialStatus,
  flag,
  initialLetter,
}: {
  rowId: string;
  initialStatus: string;
  flag: string;
  initialLetter: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [letter, setLetter] = useState(initialLetter ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function setS(s: string) {
    const res = await fetch(`/api/claims/${rowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: s }),
    });
    if (res.ok) {
      setStatus(s);
      router.refresh();
    } else setError("Could not update status");
  }

  async function draft() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/claims/${rowId}/appeal`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setLetter(data.letter);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Status</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? ""}`}>{status}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => setS("appealed")} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Mark appealed</button>
          <button onClick={() => setS("recovered")} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Mark recovered</button>
          <button onClick={() => setS("closed")} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Close</button>
        </div>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={draft}
          disabled={busy || flag !== "underpaid"}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          title={flag !== "underpaid" ? "Appeals are for underpaid claims" : ""}
        >
          {busy ? "Drafting..." : letter ? "Redraft appeal letter" : "Draft appeal letter"}
        </button>
        {letter && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(letter).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {letter && (
        <textarea value={letter} onChange={(e) => setLetter(e.target.value)} rows={22} className="w-full rounded-md border border-slate-300 p-3 font-mono text-xs" />
      )}
    </section>
  );
}
