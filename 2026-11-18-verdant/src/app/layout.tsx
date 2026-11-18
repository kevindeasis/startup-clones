import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { isMock } from "@/lib/llm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Permitly - City of Pinecrest permits",
  description: "Independent learning clone of Verdant: AI permitting for local governments.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Permitly · City of Pinecrest</Link>
          <nav>
            <Link href="/apply">Residents</Link>
            <Link href="/staff">Staff</Link>
          </nav>
          {isMock() && <span className="badge">Mock mode — set ANTHROPIC_API_KEY for live AI</span>}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
