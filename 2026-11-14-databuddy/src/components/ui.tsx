import type { ReactNode } from "react";

export const Card = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => (
  <section className={`rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 ${className}`}>
    {title && <h2 className="mb-3 text-sm font-semibold text-[var(--muted)]">{title}</h2>}
    {children}
  </section>
);

export const Button = ({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={`rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${className}`}
  />
);

export const inputClass = "rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm";

export const MockBanner = () => (
  <div role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    Mock mode - set ANTHROPIC_API_KEY for the real AI analyst
  </div>
);

export const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
