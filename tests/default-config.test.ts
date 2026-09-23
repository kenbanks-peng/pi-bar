import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { config, type PiBarConfig } from '../src/config.js';
import { buildStatusbarSegments } from '../src/statusbar.js';

const defaults = Bun.TOML.parse(
  readFileSync(new URL('../config.toml', import.meta.url), 'utf8')
) as unknown as PiBarConfig;
const mcp = defaults.statusbar.segments.find((segment) => segment.key === 'mcp')!;
const originalSegments = config.statusbar.segments;
const originalColors = config.colors;
afterEach(() => {
  config.statusbar.segments = originalSegments;
  config.colors = originalColors;
});

test('default usage segment shows totals and collapses to cost', () => {
  const usage = defaults.statusbar.segments.find((segment) => segment.type === 'usage');
  expect(usage).toBeDefined();
  config.statusbar.segments = [usage!];
  config.colors = defaults.colors;
  const ctx = { sessionManager: { getBranch: () => [{
    type: 'message', message: { role: 'assistant', usage: {
      input: 100_000, cacheRead: 24_000, output: 8_200, cost: { total: 0.43 },
    } },
  }] } } as unknown as ExtensionContext;
  const render = (width: number) => buildStatusbarSegments(ctx, {} as ExtensionAPI, {
    spinnerFrame: 0, displayedTools: [], displayedStreaming: false, statuses: new Map(),
  }, width).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  expect(render(200)).toContain('↑124k ↓8.2k $0.43');
  expect(render(10)).toContain('$0.43');
  expect(render(10)).not.toContain('↑');
});

const cases = [
  ['🔌 MCP: 1 server enabled', '0/1', 'alert'],
  ['🔌 MCP: 1 server enabled (1 connected)', '1/1', 'ok'],
  ['MCP: 2 servers enabled', '0/2', 'alert'],
  ['MCP: 2 servers enabled (0 connected)', '0/2', 'alert'],
  ['MCP: 2 servers enabled (1 connected)', '1/2', 'warn'],
  ['MCP: 2 servers enabled (2 connected)', '2/2', 'ok'],
  ['MCP: 12 servers enabled (12 connected)', '12/12', 'ok'],
  ['MCP: 1 server enabled (2 disabled)', '0/1', 'alert'],
  ['MCP: 1 server enabled (1 connected) (2 disabled)', '1/1', 'ok'],
  ['MCP: 0 servers enabled (1 disabled)', '0/0', 'alert'],
  ['MCP 0/1', '0/1', 'alert'],
  ['MCP 1/1', '1/1', 'ok'],
  ['MCP 1/2', '1/2', 'warn'],
  ['MCP: 0/1 servers', '0/1', 'alert'],
  ['MCP: 1/1 servers', '1/1', 'ok'],
  ['MCP: 1/2 servers', '1/2', 'warn'],
  ['🔌 MCP: connecting to example...', 'MCP …', 'warn'],
  ['MCP: unavailable', 'MCP', 'warn'],
] as const;

for (const [text, expected, background] of cases) {
  test(`default MCP segment: ${text}`, () => {
    config.statusbar.segments = [mcp];
    config.colors = defaults.colors;
    const output = buildStatusbarSegments({} as ExtensionContext, {} as ExtensionAPI, {
      spinnerFrame: 0,
      displayedTools: [],
      displayedStreaming: false,
      statuses: new Map([['mcp', `\x1b[36m${text}\x1b[0m`]]),
    }, 200);
    const plain = output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    expect(plain).toContain(` 󰛳 ${expected} `);
    const rgb = defaults.colors[background].slice(1).match(/../g)!
      .map((part) => Number.parseInt(part, 16)).join(';');
    expect(output).toContain(`\x1b[48;2;${rgb}m`);
  });
}
