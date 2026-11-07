import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isMock } from "@/lib/llm";

export const metadata: Metadata = {
  title: "Gatherlite — an API for how buyers think",
  description: "Local clone of GatherHQ: AI-run buyer interviews, a living buyer model, and simulations.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 dark:border-stone-800">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">Gatherlite</Link>
            {isMock() && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">Mock LLM mode</span>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
