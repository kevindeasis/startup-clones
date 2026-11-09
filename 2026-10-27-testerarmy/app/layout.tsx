import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = { title: 'TesterArmy clone', description: 'Natural-language browser tests run by an agent' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-semibold">TesterArmy <span className="text-neutral-400 font-normal">clone</span></Link>
            <nav className="flex gap-4 text-sm text-neutral-600">
              <Link href="/">Tests</Link>
              <Link href="/tests/new">New test</Link>
              <Link href="/demo">Demo app</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
