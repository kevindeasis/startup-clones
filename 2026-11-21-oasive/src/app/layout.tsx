import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { mode } from "@/lib/llm";
import { ModeBadge } from "@/components/Badges";

export const metadata: Metadata = {
  title: "MuniWatch - AI credit research for muni bonds (learning clone)",
  description: "Independent learning clone of Oasive. Not affiliated. All obligors, documents and articles are fictional.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap header-inner">
            <Link href="/" className="brand">
              MuniWatch
            </Link>
            <nav aria-label="Main">
              <Link href="/">Obligors</Link>
              <Link href="/news">News</Link>
              <Link href="/watchlists">Watchlists</Link>
              <Link href="/ask">Ask</Link>
            </nav>
            <ModeBadge mode={mode()} />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap foot">
          Independent learning clone, not affiliated with Oasive. All obligors, documents and news articles are fictional.
        </footer>
      </body>
    </html>
  );
}
