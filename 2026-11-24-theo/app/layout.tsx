import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isMock } from "@/lib/llm";

export const metadata: Metadata = { title: "Theo clone", description: "Independent learning clone of Theo: AI site builder + weekly SEO growth agent" };
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {isMock() && <div className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900">Mock mode: no ANTHROPIC_API_KEY set. Deterministic fixtures are used instead of an LLM.</div>}
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold">Theo<span className="text-emerald-600">.clone</span></Link>
            <nav className="flex gap-4 text-sm"><Link href="/new">Build a site</Link><Link href="/audit">Free audit</Link></nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-500">Independent learning clone. Not affiliated with Theo or Finale Labs, Inc.</footer>
      </body>
    </html>
  );
}
