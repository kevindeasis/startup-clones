import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visa Copilot - tourist visa prep",
  description: "Demo clone of an AI-assisted tourist-visa service. A guide, never a visa decision.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-indigo-700">Visa Copilot</Link>
            <nav className="flex gap-4 text-sm text-slate-600">
              <Link href="/quiz">Readiness quiz</Link>
              <Link href="/apply/new">Start application</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-slate-500">
          Educational clone project. Requirements, fees and scores are illustrative and must be confirmed with the
          embassy/visa centre. A guide, never a visa decision.
        </footer>
      </body>
    </html>
  );
}
