import type { Check } from "@/lib/types";

const order: Check["status"][] = ["fail", "needs_info", "pass"];

export function Checks({ checks }: { checks: Check[] }) {
  return (
    <div>
      {order.map((s) => {
        const group = checks.filter((c) => c.status === s);
        if (!group.length) return null;
        return (
          <section key={s}>
            <h3 className={s}>{s.replace("_", " ")} ({group.length})</h3>
            {group.map((c) => (
              <div key={c.id} className={`check ${c.status}`}>
                <strong>{c.title}</strong> <span className="pill">§ {c.citation}</span>{" "}
                <span className="pill">{c.source}</span>
                <div className="muted">{c.detail}</div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
