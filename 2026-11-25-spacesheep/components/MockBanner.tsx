"use client";
import { useEffect, useState } from "react";
export default function MockBanner() {
  const [mock, setMock] = useState(false);
  useEffect(() => { fetch("/api/health").then((r) => r.json()).then((h) => setMock(!!h.mock)).catch(() => {}); }, []);
  if (!mock) return null;
  return <div className="bg-amber-100 text-amber-900 text-sm px-4 py-1.5 text-center border-b border-amber-200">MOCK mode: no ANTHROPIC_API_KEY set. @paddock uses a deterministic fake editor.</div>;
}
