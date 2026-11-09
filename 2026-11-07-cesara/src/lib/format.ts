export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
