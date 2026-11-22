import type { Metadata } from "next";
import Link from "next/link";
import { mode } from "@/lib/llm";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostSale — post-sales AI workspace (learning clone)",
  description: "Independent learning clone of Quivly AI. Not affiliated with Quivly.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const m = mode();
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">PostSale</Link>
          <Link href="/">Portfolio</Link>
          <Link href="/actions">Actions</Link>
          <Link href="/radar">Radar</Link>
          <Link href="/ask">Ask</Link>
          <Link href="/projects/new">New project</Link>
          <span className="spacer" />
          <span className={`badge ${m}`} title={m === "mock" ? "Deterministic offline mode" : "Live Anthropic model"}>{m}</span>
        </nav>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
