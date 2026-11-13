"use client";

import { useEffect, useRef, useState } from "react";

export default function MermaidView({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      try {
        const { svg } = await mermaid.render(`m${Math.random().toString(36).slice(2)}`, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render the map");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) return <pre className="overflow-auto rounded bg-slate-100 p-3 text-xs">{source}</pre>;
  return <div ref={ref} data-testid="process-map" className="overflow-auto rounded border bg-white p-3" />;
}
