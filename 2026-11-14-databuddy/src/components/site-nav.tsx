"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Dashboard"],
  ["/funnels", "Funnels & goals"],
  ["/ask", "Ask Bunny"],
  ["/insights", "Insights"],
  ["/setup", "Setup"],
] as const;

export function SiteNav({ id, name }: { id: string; name: string }) {
  const pathname = usePathname();
  return (
    <div className="mb-6">
      <h1 className="mb-3 text-xl font-semibold tracking-tight">{name}</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)]">
        {TABS.map(([suffix, label]) => {
          const href = `/sites/${id}${suffix}`;
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${active ? "border-[var(--accent)] font-medium text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
