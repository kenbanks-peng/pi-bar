import { afterEach, describe, expect, test } from 'bun:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { config, type StatusbarSegmentConfig } from '../src/config.js';
import { buildStatusbarSegments } from '../src/statusbar.js';
import { formatUsageTokens, getUsageTotals } from '../src/usage.js';

const originalSegments = config.statusbar.segments;
afterEach(() => { config.statusbar.segments = originalSegments; });

function context(entries: unknown[]): ExtensionContext {
  return { sessionManager: { getBranch: () => entries } } as unknown as ExtensionContext;
}

const sample = { input: 100_000, cacheRead: 20_000, cacheWrite: 4_000, output: 8_200, cost: { total: 0.43 } };
const message = (usage: unknown, role = 'assistant') => ({ type: 'message', message: { role, usage } });
const segment: StatusbarSegmentConfig = {
  type: 'usage', template: '↑{input} ↓{output} ${cost}',
  collapse_order: 3, collapsed_template: '${cost}',
};

function render(ctx: ExtensionContext, width?: number, custom = segment): string {
  config.statusbar.segments = [custom];
  return buildStatusbarSegments(ctx, {} as ExtensionAPI, {
    spinnerFrame: 0, displayedTools: [], displayedStreaming: false, statuses: new Map(),
  }, width).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

describe('usage totals', () => {
  test('includes cached input and recorded tool/summary usage, not retained duplicates', () => {
    const totals = getUsageTotals(context([
      message(sample),
      message({ input: 10, output: 2, cost: { total: 0.01 } }, 'toolResult'),
      { type: 'compaction', usage: { input: 20, output: 3 }, retainedTail: [message(sample).message] },
      { type: 'branch_summary', usage: { input: 30, output: 4 } },
      message(sample, 'user'),
      { type: 'custom', usage: sample },
      { type: 'model_change' },
    ]));
    expect(totals).toEqual({ input: 124_060, output: 8_209, cacheRead: 20_000, cacheWrite: 4_000, cost: 0.44 });
  });

  test('handles old sessions, empty branches, and invalid numeric fields', () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    expect(getUsageTotals(context([]))).toEqual(zero);
    expect(getUsageTotals(context([
      message(undefined), message(undefined, 'toolResult'),
      { type: 'compaction' }, { type: 'branch_summary' },
      message({ input: NaN, output: -1, cacheRead: Infinity, cost: { total: NaN } }),
    ]))).toEqual(zero);
  });

  test('reflects resumed history, new messages, branch changes, and resets', () => {
    const entries = [message(sample)];
    const ctx = context(entries);
    expect(render(ctx)).toBe('↑124k ↓8.2k $0.43');
    entries.push(message(sample));
    expect(render(ctx)).toBe('↑248k ↓16.4k $0.86');
    entries.pop();
    expect(render(ctx)).toBe('↑124k ↓8.2k $0.43');
    entries.length = 0;
    expect(render(ctx)).toBe('↑0 ↓0 $0.00');
  });
});

describe('usage rendering', () => {
  test('renders full, collapses to cost, then hides on narrow terminals', () => {
    const ctx = context([message(sample)]);
    expect(render(ctx, 80)).toBe('↑124k ↓8.2k $0.43');
    expect(render(ctx, 5)).toBe('$0.43');
    expect(render(ctx, 4)).toBe('');
  });

  test('offers cache tokens and a default template', () => {
    const ctx = context([message(sample)]);
    expect(render(ctx, undefined, { type: 'usage' })).toBe('↑124k ↓8.2k $0.43');
    expect(render(ctx, undefined, { type: 'usage', template: '{cache_read}/{cache_write}' })).toBe('20k/4k');
  });

  test('respects visibility without reading session history', () => {
    expect(render({} as ExtensionContext, 80, { ...segment, show_if: 'false' })).toBe('');
  });

  test('reads history only once for full and collapsed templates', () => {
    let calls = 0;
    const ctx = { sessionManager: { getBranch: () => { calls++; return [message(sample)]; } } } as unknown as ExtensionContext;
    render(ctx, 5);
    expect(calls).toBe(1);
  });

  for (const [value, expected] of [
    [0, '0'], [999, '999'], [1_000, '1k'], [8_200, '8.2k'],
    [124_000, '124k'], [999_499, '999k'], [999_500, '1M'],
    [1_000_000, '1M'], [1_250_000, '1.3M'],
  ] as const) {
    test(`formats ${value} as ${expected}`, () => {
      expect(formatUsageTokens(value)).toBe(expected);
    });
  }
});
