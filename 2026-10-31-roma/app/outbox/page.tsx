"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/components/api";

type Mail = { id: string; to: string; subject: string; body: string; sentAt: string };
export default function Outbox() {
  const [mail, setMail] = useState<Mail[]>([]);
  useEffect(() => { api<{ outbox: Mail[] }>("/api/outbox").then((r) => setMail(r.outbox)); }, []);
  return (
    <Shell active="outbox">
      <div className="p-4">
        <h1 className="mb-1 text-xl font-semibold">Outbox</h1>
        <p className="mb-3 text-sm text-stone-500">Approved emails. In this clone nothing is actually sent.</p>
        <div className="space-y-3">
          {mail.length === 0 && <p className="text-sm text-stone-500">No approved emails yet.</p>}
          {mail.map((m) => (
            <div key={m.id} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
              <div className="font-medium">{m.subject}</div>
              <div className="text-xs text-stone-500">To {m.to} at {m.sentAt}</div>
              <pre className="mt-2 whitespace-pre-wrap font-sans">{m.body}</pre>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
