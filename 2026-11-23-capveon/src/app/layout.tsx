import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { healthInfo } from "@/lib/health";

export const metadata: Metadata = {
  title: "PreBid - government work finder (learning clone)",
  description: "Independent learning clone of Capveon. Not affiliated. All data is fictional.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await healthInfo();
  return (
    <html lang="en">
      <body>
        <nav className="top">
          <Link className="brand" href="/">PreBid</Link>
          <Link href="/">Signals</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/pursuits">Pursuits</Link>
          <Link href="/agencies">Agencies</Link>
          <Link href="/profile">Profile</Link>
          <span className="spacer" />
          <span className="badge" title="LLM mode from /api/health">
            mode: {h.mode}
            {h.mode === "live" ? ` (${h.model})` : ""}
          </span>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
