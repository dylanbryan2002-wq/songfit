/** Median of a list; null for empty input. Written for `noUncheckedIndexedAccess`. */
export function median(values: number[]): number | null {
  const n = values.length;
  if (n === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const hi = s[mid] ?? 0;
  if (n % 2 === 1) return hi;
  const lo = s[mid - 1] ?? hi;
  return (lo + hi) / 2;
}
