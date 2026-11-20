import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "FullCast - every character gets a voice",
  description: "Independent learning clone of Audora: turn a story into a multi-voice audiobook script and play it back progressively.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">FullCast</Link>
          <span className="tagline">Audiobooks where every character has their own voice</span>
        </header>
        {children}
        <footer className="footer">Independent learning clone of Audora (YC F26). Not affiliated with Audora.</footer>
      </body>
    </html>
  );
}
