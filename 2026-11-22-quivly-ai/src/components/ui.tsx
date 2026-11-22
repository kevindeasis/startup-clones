import type { Action, Band, UsageWeek } from "@/lib/types";

export function HealthBadge({ score, band }: { score?: number; band?: Band }) {
  if (score === undefined || !band) return <span className="badge">n/a</span>;
  return <span className={`badge ${band}`}><span className="score">{score}</span> {band}</span>;
}

export function Sparkline({ values, w = 80, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="4-week usage trend">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function Delta({ pct }: { pct: number }) {
  const r = Math.round(pct);
  return <span className={r >= 0 ? "up" : "down"}>{r >= 0 ? "▲" : "▼"} {Math.abs(r)}%</span>;
}

/** Units as bars (last 2 weeks red when a drop is detected, prior 4 weeks emphasised), quota line, active users as a line. */
export function UsageChart({ usage, quota, drop }: { usage: UsageWeek[]; quota: number; drop: boolean }) {
  const rows = usage.slice(-12);
  if (!rows.length) return <p className="muted">No usage data yet.</p>;
  const W = 360, H = 130, pad = 22;
  const max = Math.max(quota, ...rows.map((r) => r.meteredUnits)) * 1.05;
  const maxU = Math.max(1, ...rows.map((r) => r.activeUsers)) * 1.1;
  const bw = (W - pad) / rows.length;
  const y = (v: number) => H - 16 - (v / max) * (H - 30);
  const yu = (v: number) => H - 16 - (v / maxU) * (H - 30);
  const line = rows.map((r, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${yu(r.activeUsers).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly metered units (bars) and active users (line)">
      <line x1={pad} x2={W} y1={y(quota)} y2={y(quota)} stroke="currentColor" strokeDasharray="3 3" opacity=".4" />
      <text x={pad} y={y(quota) - 2}>quota {quota.toLocaleString("en-US")}</text>
      {rows.map((r, i) => {
        const fromEnd = rows.length - i;
        const cls = drop && fromEnd <= 2 ? "bar drop" : drop && fromEnd <= 6 ? "bar prior" : "bar";
        return <rect key={r.weekStart} className={cls} x={pad + i * bw + 2} y={y(r.meteredUnits)} width={bw - 4} height={H - 16 - y(r.meteredUnits)}><title>{`${r.weekStart}: ${r.meteredUnits.toLocaleString("en-US")} units, ${r.activeUsers} active users`}</title></rect>;
      })}
      <polyline points={line} fill="none" stroke="var(--amber)" strokeWidth="2" />
      <text x={pad} y={H - 3}>{rows[0].weekStart}</text>
      <text x={W - 56} y={H - 3}>{rows.at(-1)!.weekStart}</text>
    </svg>
  );
}

export function ActionBadges({ a }: { a: Pick<Action, "priority" | "type" | "play"> }) {
  return (
    <span className="row" style={{ gap: ".3rem" }}>
      <span className={`badge ${a.priority}`}>{a.priority}</span>
      <span className="badge">{a.type.replace(/_/g, " ")}</span>
      <span className="badge">{a.play.replace(/_/g, " ")}</span>
    </span>
  );
}

/** Tiny markdown renderer for briefs: #/## headings, - bullets, **bold**. */
export function Markdown({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) { list.push(line.slice(2)); continue; }
    flush();
    if (line.startsWith("## ")) out.push(<h2 key={out.length}>{line.slice(3)}</h2>);
    else if (line.startsWith("# ")) out.push(<h1 key={out.length}>{line.slice(2)}</h1>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="md">{out}</div>;
}
