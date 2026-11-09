import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { MOCK_LLM } from '@/lib/llm';

export const metadata: Metadata = { title: 'Lantern-lite', description: 'Turn your taste into hires (self-hosted clone)' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {MOCK_LLM && (
          <div data-testid="mock-banner" className="bg-amber-200 px-4 py-1 text-center text-sm text-amber-900">
            Mock LLM mode: outputs are deterministic fakes. Set ANTHROPIC_API_KEY (and unset MOCK_LLM) for real reviews.
          </div>
        )}
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-bold">Lantern-lite</Link>
            <span className="text-sm text-stone-500">Turn your taste into hires</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
