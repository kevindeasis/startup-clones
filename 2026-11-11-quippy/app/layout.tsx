import type { Metadata } from "next";
import Link from "next/link";
import { isMock } from "@/lib/llm";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rehearsal Room - Quippy clone",
  description: "Practice real conversations with an AI scene partner and get line-by-line feedback. Independent learning clone, not affiliated with Quippy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mock = isMock();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-stone-200 dark:border-stone-800">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold text-indigo-600 dark:text-indigo-400">Rehearsal Room</Link>
            <Link href="/" className="hover:underline">Practice</Link>
            <Link href="/progress" className="hover:underline">Progress</Link>
            <Link href="/custom" className="hover:underline">Practice anything</Link>
            {mock && (
              <span title="No API key or LLM_MOCK=1: canned replies and heuristic feedback" className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                Mock LLM
              </span>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 py-4 text-xs text-stone-500">Independent learning clone, not affiliated with Quippy.</footer>
      </body>
    </html>
  );
}
