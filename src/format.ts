/**
 * Pure formatting helpers — no I/O, no ANSI, no pi imports.
 */

/** Format a number like "200k" or "1M". */
export function humanReadable(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }
  return `${n}`;
}
