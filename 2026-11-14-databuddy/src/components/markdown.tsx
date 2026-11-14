import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i} className="rounded bg-zinc-100 px-1 text-[0.85em]">{part.slice(1, -1)}</code>;
    return part;
  });
}

/** Tiny Markdown subset (headings, bullets, bold, code) rendered as React nodes, never as raw HTML. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split("\n").filter(Boolean);
        if (lines.every((l) => l.startsWith("- "))) {
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        }
        if (lines[0]?.startsWith("#")) {
          const level = lines[0].match(/^#+/)![0].length;
          return <p key={i} className={level <= 2 ? "text-base font-semibold" : "font-semibold"}>{inline(lines[0].replace(/^#+\s*/, ""))}</p>;
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}
