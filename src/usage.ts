import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// Optional fields keep older sessions and Pi versions (before tool/summary
// usage was added) compatible without requiring a newer peer dependency.
interface RecordedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/** Recorded usage on the active branch, including history before compaction. */
export function getUsageTotals(ctx: ExtensionContext): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of ctx.sessionManager.getBranch()) {
    const source = entry.type === 'message'
      ? ((entry.message.role === 'assistant' || entry.message.role === 'toolResult')
        ? entry.message : undefined)
      : ((entry.type === 'compaction' || entry.type === 'branch_summary')
        ? entry : undefined);
    const usage = (source as { usage?: RecordedUsage } | undefined)?.usage;
    if (!usage) continue;

    const cacheRead = nonNegative(usage.cacheRead);
    const cacheWrite = nonNegative(usage.cacheWrite);
    totals.input += nonNegative(usage.input) + cacheRead + cacheWrite;
    totals.output += nonNegative(usage.output);
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    totals.cost += nonNegative(usage.cost?.total);
  }
  return totals;
}

function nonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Compact token counts with one decimal below 100 units; no trailing .0. */
export function formatUsageTokens(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  const divisor = value < 999_500 ? 1_000 : 1_000_000;
  const scaled = value / divisor;
  return `${Number(scaled.toFixed(scaled < 100 ? 1 : 0))}${divisor === 1_000 ? 'k' : 'M'}`;
}
