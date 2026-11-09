import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Roma clone - the to-do list that does itself",
  description: "Unofficial learning clone of Roma. Not affiliated with Roma.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
