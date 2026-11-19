import type { Metadata } from "next";
import Link from "next/link";
import MockBadge from "@/components/MockBadge";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BrokerDesk - Covera learning clone",
  description: "Independent learning clone of Covera: an AI-native OS for insurance brokers. Not affiliated with Covera.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">BrokerDesk <span className="muted">Harbor Point Insurance</span></Link>
          <nav>
            <Link href="/">Pipeline</Link>
            <Link href="/intake">Intake</Link>
            <Link href="/book">Book</Link>
            <Link href="/portal/northstar">Portals</Link>
          </nav>
          <MockBadge />
        </header>
        <main className="container">{children}</main>
        <footer className="footer muted">
          Independent learning clone of Covera (YC F26). Not affiliated with Covera. A human approves every action.
        </footer>
      </body>
    </html>
  );
}
