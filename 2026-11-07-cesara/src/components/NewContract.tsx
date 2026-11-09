"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewContract() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/contracts", { method: "POST", ...init });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push(`/contracts/${data.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    submit({ body: fd });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">New contract</h2>
      <label
        className="mb-3 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 p-6 text-sm text-slate-500 hover:border-emerald-500"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files[0]);
        }}
      >
        Drop a contract PDF / .txt / .md here, or click to choose
        <input type="file" accept=".pdf,.txt,.md,text/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="...or paste contract text here"
        className="mb-3 w-full rounded-md border border-slate-300 p-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || !text.trim()}
          onClick={() => submit({ headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) })}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Extracting..." : "Extract terms from text"}
        </button>
        <button
          disabled={busy}
          onClick={() => submit({ headers: { "content-type": "application/json" }, body: JSON.stringify({ sample: true }) })}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Load sample contract
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
