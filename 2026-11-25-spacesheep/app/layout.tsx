import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paddock", description: "Shared workspace for people and their AI agents (independent learning clone)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
