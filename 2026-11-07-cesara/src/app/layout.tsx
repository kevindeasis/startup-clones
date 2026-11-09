import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimCheck - contract-aware underpayment detection",
  description: "Extract payer contract terms, price claims deterministically, flag underpayments and draft appeals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              Claim<span className="text-emerald-600">Check</span>
            </Link>
            <span className="text-xs text-slate-500">Pay every claim per the contract</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="py-4 text-center text-xs text-slate-400">
          Demo clone of Cesara. Sample data is fictional. Not legal, billing or compliance advice.
        </footer>
      </body>
    </html>
  );
}
