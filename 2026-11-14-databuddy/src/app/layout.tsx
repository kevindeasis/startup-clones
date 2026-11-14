import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hutch - cookieless analytics with an AI analyst",
  description: "Independent learning clone of Databuddy. Not affiliated.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Hutch <span className="text-[var(--accent)]">Bunny</span>
            </Link>
            <span className="text-xs text-[var(--muted)]">independent learning clone, not affiliated with Databuddy</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
