import { afterEach, describe, expect, test } from 'bun:test';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { config, type StatusbarSegmentConfig } from '../src/config.js';
import { buildStatusbarSegments } from '../src/statusbar.js';

const originalSegments = config.statusbar.segments;
afterEach(() => {
  config.statusbar.segments = originalSegments;
});

const ctx = {} as ExtensionContext;
const pi = { getThinkingLevel: () => 'off' } as ExtensionAPI;

function render(segments: StatusbarSegmentConfig[], statuses: [string, string][], width?: number) {
  config.statusbar.segments = segments;
  return buildStatusbarSegments(ctx, pi, {
    spinnerFrame: 0,
    displayedTools: [],
    displayedStreaming: false,
    statuses: new Map(statuses),
  }, width).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

const mcp: StatusbarSegmentConfig = {
  type: 'status',
  key: 'mcp',
  show_if: "Number(state.status.connected ?? state.status.text.match(/[0-9]+\\/[0-9]+/)?.[0]?.split('/')?.[0] ?? 0) > 0 || Number(state.status.servers ?? state.status.text.match(/[0-9]+\\/[0-9]+/)?.[0]?.split('/')?.[1] ?? 0) > 0",
  eval: "(state.status.connected ?? state.status.text.match(/[0-9]+\\/[0-9]+/)?.[0]?.split('/')?.[0] ?? 0) + '/' + (state.status.servers ?? state.status.text.match(/[0-9]+\\/[0-9]+/)?.[0]?.split('/')?.[1] ?? 0)",
};

describe('status visibility', () => {
  for (const width of [undefined, 200]) {
    for (const [status, expected] of [
      ['MCP: 1 servers enabled', '0/1'],
      ['MCP: 1 servers enabled (1 connected)', '1/1'],
      ['MCP: 0/1 servers', '0/1'],
      ['MCP: 1/1 servers', '1/1'],
    ]) {
      test(`${status}, width ${width}`, () => {
        expect(render([mcp], [['mcp', status]], width)).toContain(expected);
      });
    }
  }

  test('hides zero servers and absent statuses', () => {
    expect(render([mcp], [['mcp', 'MCP: 0 servers enabled']])).toBe('');
    expect(render([mcp], [['mcp', 'MCP: 0/0 servers']])).toBe('');
    expect(render([mcp], [])).toBe('');
  });

  test('evaluates wildcard conditions for each normalized status', () => {
    const segment: StatusbarSegmentConfig = {
      type: 'status', key: '*',
      show_if: 'state.status.errors > 0 && state.status.key === "visible"',
      template: '{key}: {text}',
    };
    const result = render([segment], [
      ['hidden', '0 errors'],
      ['visible', '\x1b[31m2 errors\x1b[0m'],
      ['excluded', '3 errors'],
    ]);
    expect(result).toContain('visible: 2 errors');
    expect(result).not.toContain('hidden');
    expect(result).not.toContain('excluded');
  });

  test('does not expose hidden explicit statuses through the wildcard', () => {
    expect(render([
      { ...mcp, show_if: 'false' },
      { type: 'status', key: '*', template: '{text}' },
    ], [['mcp', 'MCP: 1/1 servers']])).toBe('');
  });

  test('keeps non-status visibility checks', () => {
    expect(render([{ type: 'value', template: 'hidden', show_if: 'false' }], [])).toBe('');
    expect(render([{ type: 'value', template: 'visible', show_if: 'true' }], [])).toBe('visible');
  });

  test('keeps invalid conditions hidden', () => {
    expect(render([{ ...mcp, show_if: 'state.missing.property' }], [
      ['mcp', 'MCP: 1/1 servers'],
    ])).toBe('');
  });
});
