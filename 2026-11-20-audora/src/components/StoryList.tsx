"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StorySummary } from "@/lib/types";

export function StoryList({ stories }: { stories: StorySummary[] }) {
  const router = useRouter();
  async function remove(id: string) {
    if (!confirm("Delete this story?")) return;
    await fetch(`/api/stories/${id}`, { method: "DELETE" });
    router.refresh();
  }
  if (stories.length === 0) return <p className="muted">No stories yet. Import one above or load a sample.</p>;
  return (
    <ul className="storylist">
      {stories.map((s) => (
        <li key={s.id}>
          <div className="grow">
            <Link href={`/stories/${s.id}`} className="storytitle">{s.title}</Link>
            <div className="muted small">
              {s.wordCount.toLocaleString()} words · cast {s.castSize} · {s.sourceKind}
              {s.status === "generating" && ` · ${s.chunksDone}/${s.chunksTotal} chunks`}
            </div>
          </div>
          <span className={`badge ${s.status}`}>{s.status}</span>
          <span className={`badge mode ${s.mode}`}>{s.mode}</span>
          <button type="button" className="btn small" onClick={() => remove(s.id)} aria-label={`Delete ${s.title}`}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
