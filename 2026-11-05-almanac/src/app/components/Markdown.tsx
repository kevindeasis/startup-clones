"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState } from "react";

export function Markdown({ text, onCite }: { text: string; onCite: (id: number) => void }) {
  const prepared = text.replace(/\[src:(\d+)\]/g, "[src:$1](#src-$1)");
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#src-(\d+)$/);
            if (m) {
              return (
                <button onClick={() => onCite(Number(m[1]))} className="mx-0.5 cursor-pointer rounded bg-indigo-100 px-1 text-xs font-medium text-indigo-700 hover:bg-indigo-200">
                  {children}
                </button>
              );
            }
            return <a href={href} className="text-indigo-600 underline" target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

type Src = { id: number; title: string; kind: string; createdAt: string; text: string };
export function SourceDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const [src, setSrc] = useState<Src | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (id == null) return;
    setSrc(null);
    setErr(false);
    fetch(`/api/sources?id=${id}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setSrc).catch(() => setErr(true));
  }, [id]);
  if (id == null) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[28rem] max-w-full flex-col border-l border-slate-300 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 p-3">
        <div className="text-sm font-semibold">Source {id}{src ? `: ${src.title}` : ""}</div>
        <button className="btn-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {err && <p className="text-sm text-red-600">Source {id} not found (it may have been deleted).</p>}
        {src && (
          <>
            <p className="mb-2 text-xs text-slate-500">{src.kind} · added {new Date(src.createdAt).toLocaleString()}</p>
            <pre className="whitespace-pre-wrap text-sm">{src.text}</pre>
          </>
        )}
      </div>
    </div>
  );
}
