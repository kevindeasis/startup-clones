const COLORS: Record<string, string> = {
  passed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-orange-100 text-orange-800',
  running: 'bg-blue-100 text-blue-800',
  queued: 'bg-neutral-200 text-neutral-700',
  skipped: 'bg-neutral-200 text-neutral-600',
};
export function StatusBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-neutral-400">never run</span>;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLORS[status] ?? ''}`}>{status}</span>;
}
