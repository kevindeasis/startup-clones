import Link from "next/link";
import { isMockMode } from "../../lib/llm";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {isMockMode() && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          Mock mode — set ANTHROPIC_API_KEY for real interviews
        </div>
      )}
      <header className="border-b bg-white">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-lg font-semibold">Worktalk</Link>
          <Link href="/studies/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">New study</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-slate-500">
        Independent learning clone of Sona8, built for education. Not affiliated with Sona8.
      </footer>
    </>
  );
}
