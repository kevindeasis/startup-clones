import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Poth Labs clone", description: "Independent learning clone: AI-native customer research" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top"><a href="/">Poth Labs clone</a><span>independent learning clone</span></header>
        <main>{children}</main>
      </body>
    </html>
  );
}
