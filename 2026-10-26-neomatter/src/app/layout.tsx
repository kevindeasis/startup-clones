import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { llmMode } from "@/lib/llm";

export const metadata: Metadata = {
  title: "Front Door - legal intake & triage",
  description: "Independent educational clone of Neomatter: AI intake and triage for in-house legal.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {llmMode() === "mock" && (
          <div className="bg-amber-100 px-4 py-1 text-center text-xs text-amber-900">
            Mock LLM mode — set ANTHROPIC_API_KEY for real triage
          </div>
        )}
        <header className="border-b border-stone-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-semibold">Front Door</Link>
            <Link href="/" className="text-stone-600 hover:text-stone-900">Matters</Link>
            <Link href="/intake" className="text-stone-600 hover:text-stone-900">New request</Link>
            <Link href="/playbook" className="text-stone-600 hover:text-stone-900">Playbook</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
