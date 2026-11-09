import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getProvider } from "@/lib/brain/llm";

export const metadata: Metadata = { title: "Company Brain", description: "A self-updating, cited Markdown wiki for your company" };
export const dynamic = "force-dynamic";

const nav = [
  { href: "/", label: "Home" },
  { href: "/sources", label: "Sources" },
  { href: "/wiki", label: "Wiki" },
  { href: "/chat", label: "Chat" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mock = getProvider() === "mock";
  return (
    <html lang="en">
      <body>
        {mock && (
          <div className="bg-amber-100 border-b border-amber-300 px-4 py-1.5 text-center text-sm text-amber-900">
            MOCK MODE: no ANTHROPIC_API_KEY set, so a deterministic offline model produces all outputs. Set the key to use Claude.
          </div>
        )}
        <div className="flex min-h-screen">
          <aside className="w-52 shrink-0 border-r border-slate-200 bg-white p-4">
            <div className="mb-6 text-lg font-bold text-indigo-700">Company Brain</div>
            <nav className="flex flex-col gap-1">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
