/**
 * Status bar rendering — generic configured segments plus status/activity helpers.
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { basename } from 'path';

import { renderSegment, visualLength } from './ansi.js';
import {
  DEFAULT_ACTIVITY_FIELD,
  config,
  type StatusbarSegmentConfig,
  type GitStateConfig,
  type MeterStateConfig,
  type StatusStateConfig,
} from './config.js';
import { humanReadable } from './format.js';
import type { GitSnapshot } from './git.js';
import { color } from './palette.js';

export interface StatusbarRenderState {
  spinnerFrame: number;
  displayedTools: readonly string[];
  displayedStreaming: boolean;
  statuses: ReadonlyMap<string, string>;
  status?: Record<string, unknown>;
  git?: GitSnapshot;
}

/** Build the full status bar line from the ordered [[statusbar.segments]] config, with optional responsive collapsing. */
export function buildStatusbarSegments(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState,
  width?: number
): string {
  const explicitlyConfiguredStatusKeys = configuredStatusKeys();
  
  // 1. Get all segments that should be shown under normal conditions
  const activeSegments = config.statusbar.segments.filter((segment) =>
    shouldShowSegment(segment, ctx, pi, state)
  );

  // If no width constraint is specified, render everything fully
  if (width === undefined) {
    return activeSegments
      .map((segment) =>
        safeRenderStatusbarSegment(segment, ctx, pi, state, explicitlyConfiguredStatusKeys, false)
      )
      .join('');
  }

  // 2. Pre-render all active segments in Full and Collapsed states.
  // A segment participates in responsive collapse only when it declares either
  // collapse_order or collapsed_eval. A collapsed_eval without collapse_order
  // defaults to order 1; a collapse_order without collapsed_eval collapses to
  // an empty render.
  const renderedList = activeSegments.map((segment, index) => {
    const fullRender = safeRenderStatusbarSegment(segment, ctx, pi, state, explicitlyConfiguredStatusKeys, false);
    const collapsedRender = safeRenderStatusbarSegment(segment, ctx, pi, state, explicitlyConfiguredStatusKeys, true);

    const fullLen = visualLength(fullRender);
    const collapsedLen = visualLength(collapsedRender);
    const collapsible = isCollapsibleSegment(segment);

    return {
      segment,
      index,
      collapsible,
      collapseOrder: collapsible ? (segment.collapse_order ?? 1) : Infinity,
      fullRender,
      fullLen,
      collapsedRender,
      collapsedLen,
      currentState: 'Full' as 'Full' | 'Collapsed' | 'Hidden',
    };
  });

  // 3. Compute initial total width
  let currentTotalLen = renderedList.reduce((sum, item) => sum + item.fullLen, 0);

  // 4. If it fits, return the full renders
  if (currentTotalLen <= width) {
    return renderedList.map((item) => item.fullRender).join('');
  }

  // 5. Degrade systematically until it fits (or we cannot degrade any further)
  while (currentTotalLen > width) {
    let targetIndex = -1;
    let targetCollapseOrder = Infinity;

    // Find the earliest collapse-order segment that is currently 'Full' and collapsible.
    for (let i = renderedList.length - 1; i >= 0; i--) {
      const item = renderedList[i]!;
      if (item.collapsible && item.currentState === 'Full' && item.collapsedLen < item.fullLen) {
        if (item.collapseOrder < targetCollapseOrder) {
          targetCollapseOrder = item.collapseOrder;
          targetIndex = i;
        }
      }
    }

    if (targetIndex !== -1) {
      // Transition Full -> Collapsed
      const item = renderedList[targetIndex]!;
      item.currentState = 'Collapsed';
      currentTotalLen -= (item.fullLen - item.collapsedLen);
      continue;
    }

    // If no more Full -> Collapsed transitions are possible, hide the earliest
    // eligible segment that still has a visible render.
    targetIndex = -1;
    targetCollapseOrder = Infinity;

    for (let i = renderedList.length - 1; i >= 0; i--) {
      const item = renderedList[i]!;
      const currentLen = item.currentState === 'Full' ? item.fullLen : item.collapsedLen;
      if (item.collapsible && item.currentState !== 'Hidden' && currentLen > 0) {
        if (item.collapseOrder < targetCollapseOrder) {
          targetCollapseOrder = item.collapseOrder;
          targetIndex = i;
        }
      }
    }

    if (targetIndex !== -1) {
      // Transition to Hidden
      const item = renderedList[targetIndex]!;
      const currentLen = item.currentState === 'Full' ? item.fullLen : item.collapsedLen;
      item.currentState = 'Hidden';
      currentTotalLen -= currentLen;
    } else {
      // Nothing left to degrade!
      break;
    }
  }

  // 6. Join and return the final segments
  return renderedList
    .map((item) => {
      if (item.currentState === 'Full') return item.fullRender;
      if (item.currentState === 'Collapsed') return item.collapsedRender;
      return '';
    })
    .join('');
}

function hasCollapsedEval(segment: StatusbarSegmentConfig): boolean {
  return hasText(segment.collapsed_template) || hasText(segment.collapsed_eval);
}

function isCollapsibleSegment(segment: StatusbarSegmentConfig): boolean {
  return segment.collapse_order !== undefined || hasCollapsedEval(segment);
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}


function configuredStatusKeys(): ReadonlySet<string> {
  return new Set(
    config.statusbar.segments
      .filter((segment) => segment.type === 'status')
      .map((segment) => segment.key?.trim())
      .filter((key): key is string => Boolean(key && key !== '*'))
  );
}

function safeRenderStatusbarSegment(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState,
  explicitlyConfiguredStatusKeys: ReadonlySet<string>,
  isCollapsed = false
): string {
  try {
    return renderStatusbarSegment(
      segment,
      ctx,
      pi,
      state,
      explicitlyConfiguredStatusKeys,
      isCollapsed
    );
  } catch {
    return '';
  }
}

function renderStatusbarSegment(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState,
  explicitlyConfiguredStatusKeys: ReadonlySet<string>,
  isCollapsed = false
): string {
  if (!shouldShowSegment(segment, ctx, pi, state)) return '';

  // Create a copy of the segment with collapsed properties overriding normal ones
  const activeSegment = { ...segment, isCollapsed };
  if (isCollapsed) {
    if (!hasCollapsedEval(segment)) {
      return '';
    }
    if (segment.collapsed_template !== undefined) {
      activeSegment.template = segment.collapsed_template;
      activeSegment.eval = undefined;
    }
    if (segment.collapsed_eval !== undefined) {
      activeSegment.eval = segment.collapsed_eval;
    }
  }

  switch (activeSegment.type) {
    case 'value':
      return renderValueSegment(activeSegment, ctx, pi, state);
    case 'meter':
      return renderMeterSegment(activeSegment, ctx, pi, state);
    case 'status':
      return renderStatusSegment(
        activeSegment,
        state.statuses,
        ctx,
        pi,
        state,
        explicitlyConfiguredStatusKeys
      );
    case 'activity':
      return renderActivitySegment(state, activeSegment, ctx, pi);
    case 'git':
      return renderGitSegment(activeSegment, state);
    case 'dir':
      return renderDirSegment(activeSegment, ctx);
  }
}

function renderTextSegment(
  segment: StatusbarSegmentConfig,
  text: string | null | undefined
): string {
  if (!text) return '';
  const fg = segment.fg ?? 'text';
  const bg = segment.bg;
  const minWidth = segment.isCollapsed ? undefined : segment.min_width;
  const paddedText = padText(text, minWidth);
  if (!bg) return paddedText;
  return renderConfiguredSegment(color(bg, 'bg'), color(fg, 'fg'), ` ${paddedText} `);
}

function padText(text: string, minWidth: number | undefined): string {
  if (typeof minWidth !== 'number' || text.length >= minWidth) return text;
  return `${text}${' '.repeat(minWidth - text.length)}`;
}

interface StatusbarExpressionContext {
  segment: StatusbarSegmentConfig;
  ctx: ExtensionContext;
  pi: ExtensionAPI;
  state: StatusbarRenderState;
  value?: number;
  activity?: Record<string, string | boolean | undefined>;
}

type TemplateTokens = Record<string, string | number | boolean | null | undefined>;

function shouldShowSegment(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState
): boolean {
  const condition = segment.show_if?.trim();
  if (!condition) return true;

  return Boolean(
    safeEvaluateStatusbarExpression(condition, { segment, ctx, pi, state }, false)
  );
}

function renderValueSegment(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState
): string {
  const template = segment.template;
  if (template !== undefined) {
    return renderTextSegment(segment, renderTemplate(template, valueTokens(segment, ctx, pi)));
  }

  const expression = segment.eval?.trim();
  if (!expression) return renderTextSegment(segment, segment.empty_text ?? '');

  const value = safeEvaluateStatusbarExpression(expression, { segment, ctx, pi, state });
  return renderTextSegment(segment, stringifySegmentValue(value, segment));
}

function renderGitSegment(segment: StatusbarSegmentConfig, state: StatusbarRenderState): string {
  const git = state.git;
  if (!git) return '';

  const template = segment.template ?? ' {remote_icon}{branch_icon}{branch} ';
  const stateConfig = gitState(git, segment);
  const displaySegment = {
    ...segment,
    fg: stateConfig?.fg ?? segment.fg,
    bg: stateConfig?.bg ?? segment.bg,
  };
  return renderTextSegment(displaySegment, renderTemplate(template, gitTokens(git, segment)));
}

function renderDirSegment(segment: StatusbarSegmentConfig, ctx: ExtensionContext): string {
  const template = segment.template ?? '  {dir}';
  return renderTextSegment(segment, renderTemplate(template, dirTokens(ctx)));
}

function renderTemplate(template: string, tokens: TemplateTokens): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_match, token: string) => {
    const value = tokens[token];
    if (value === null || value === undefined || value === false) return '';
    return String(value);
  });
}

function valueTokens(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI
): TemplateTokens {
  const modelId = ctx.model?.id ?? segment.empty_text ?? '';
  const shortModel = ctx.model?.id
    ? (ctx.model.id.includes('/') ? ctx.model.id.split('/').pop() : ctx.model.id)
    : '';
  return {
    value: modelId,
    model: modelId,
    short_model: shortModel,
    thinking: pi.getThinkingLevel(),
  };
}

function gitTokens(git: GitSnapshot, segment: StatusbarSegmentConfig): TemplateTokens {
  const remoteIcon = segment.icons?.remote ?? git.serviceIcon;
  const branchIcon = segment.icons?.branch ?? git.branchIcon;
  return {
    value: `${remoteIcon}${branchIcon}${git.branch}`,
    branch: git.branch,
    branch_icon: branchIcon,
    service: git.service,
    service_icon: git.serviceIcon,
    remote_icon: remoteIcon,
    remote: git.remote,
    staged: git.staged,
    unstaged: git.unstaged,
    staged_count: git.stagedCount,
    modified_count: git.modifiedCount,
    untracked_count: git.untrackedCount,
    conflict_count: git.conflictCount,
    ahead: git.ahead,
    behind: git.behind,
    counts: formatGitCounts(git, segment),
  };
}

interface GitCountLabels {
  staged: string;
  modified: string;
  untracked: string;
  conflicts: string;
}

// Built-in notation presets. `symbol` mirrors git porcelain short codes;
// `letter` is a more literal, spelled-out style. Either can be overridden
// per-label via the segment's `count_labels` inline table.
const GIT_COUNT_PRESETS: Record<string, GitCountLabels> = {
  symbol: { staged: '+', modified: '~', untracked: '?', conflicts: '!' },
  letter: { staged: 'S: ', modified: 'M: ', untracked: 'U: ', conflicts: '!: ' },
};

function gitCountLabels(segment: StatusbarSegmentConfig): GitCountLabels {
  const preset = GIT_COUNT_PRESETS[segment.count_style ?? 'symbol'] ?? GIT_COUNT_PRESETS.symbol;
  const custom = segment.count_labels ?? {};
  return {
    staged: custom.staged ?? preset.staged,
    modified: custom.modified ?? preset.modified,
    untracked: custom.untracked ?? preset.untracked,
    conflicts: custom.conflicts ?? preset.conflicts,
  };
}

function formatGitCounts(git: GitSnapshot, segment: StatusbarSegmentConfig): string {
  const labels = gitCountLabels(segment);
  const separator = segment.count_separator ?? ' ';
  const parts: string[] = [];
  if (git.stagedCount > 0) parts.push(`${labels.staged}${git.stagedCount}`);
  if (git.modifiedCount > 0) parts.push(`${labels.modified}${git.modifiedCount}`);
  if (git.untrackedCount > 0) parts.push(`${labels.untracked}${git.untrackedCount}`);
  if (git.conflictCount > 0) parts.push(`${labels.conflicts}${git.conflictCount}`);
  return parts.length > 0 ? `${separator}${parts.join(separator)}` : '';
}

function dirTokens(ctx: ExtensionContext): TemplateTokens {
  const path = ctx.cwd;
  const dir = basename(path) || path;
  return { value: dir, dir, path };
}

function gitState(git: GitSnapshot, segment: StatusbarSegmentConfig): GitStateConfig | undefined {
  return (segment.states ?? []).find(
    (stateConfig): stateConfig is GitStateConfig =>
      isGitStateConfig(stateConfig) && gitStateMatches(git, stateConfig)
  );
}

function gitStateMatches(git: GitSnapshot, stateConfig: GitStateConfig): boolean {
  switch (stateConfig.id) {
    case 'unstaged':
      return git.unstaged;
    case 'staged':
      return git.staged;
    case 'ahead':
      return git.ahead > 0;
    case 'behind':
      return git.behind > 0;
    default:
      return false;
  }
}

function safeEvaluateStatusbarExpression(
  expression: string,
  context: StatusbarExpressionContext,
  fallback: unknown = context.segment.empty_text ?? ''
): unknown {
  try {
    return evaluateStatusbarExpression(expression, context);
  } catch (error) {
    return fallback;
  }
}

function evaluateStatusbarExpression(
  expression: string,
  context: StatusbarExpressionContext
): unknown {
  const { segment, ctx, pi, state, value, activity } = context;
  const helpers = createStatusbarExpressionHelpers(state);
  // Configured expressions are intentionally evaluated in a constrained scope.
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    'segment',
    'ctx',
    'pi',
    'state',
    'model',
    'humanReadable',
    'lspTotalErrors',
    'lspTotalWarnings',
    'value',
    'activity',
    `"use strict"; return (${expression});`
  ) as (
    segment: StatusbarSegmentConfig,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
    state: StatusbarRenderState,
    model: ExtensionContext['model'],
    humanReadable: (n: number | null | undefined) => string,
    lspTotalErrors: () => number,
    lspTotalWarnings: () => number,
    value: number | undefined,
    activity: Record<string, string | boolean | undefined> | undefined
  ) => unknown;

  return fn(
    segment,
    ctx,
    pi,
    state,
    ctx.model,
    maybeHumanReadable,
    helpers.lspTotalErrors,
    helpers.lspTotalWarnings,
    value,
    activity
  );
}

function createStatusbarExpressionHelpers(state: StatusbarRenderState): {
  lspTotalErrors: () => number;
  lspTotalWarnings: () => number;
} {
  const status = statusRecord(state);
  return {
    lspTotalErrors: () => totalStatusCount(status, ['errors', 'error']),
    lspTotalWarnings: () => totalStatusCount(status, ['warnings', 'warning']),
  };
}

function statusRecord(state: StatusbarRenderState): Record<string, unknown> {
  return state.status ?? {};
}

function totalStatusCount(status: Record<string, unknown>, keys: string[]): number {
  return keys.reduce((total, key) => total + numericStatusValue(status[key]), 0);
}

function numericStatusValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function maybeHumanReadable(n: number | null | undefined): string {
  return typeof n === 'number' ? humanReadable(n) : '';
}

function stringifySegmentValue(value: unknown, segment: StatusbarSegmentConfig): string {
  if (value === null || value === undefined || value === false) {
    return segment.empty_text ?? '';
  }
  if (typeof value === 'string') return value || (segment.empty_text ?? '');
  if (typeof value === 'number' || typeof value === 'bigint' || value === true) {
    return String(value);
  }
  return JSON.stringify(value) ?? segment.empty_text ?? '';
}

function renderMeterSegment(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState
): string {
  const value = meterValue(segment, ctx, pi, state);
  const text = meterText(segment, ctx, pi, state, value);
  if (!text) return '';

  const stateConfig = meterState(value, segment);

  return renderConfiguredSegment(
    color(stateConfig?.bg ?? segment.bg ?? 'ok', 'bg'),
    color(stateConfig?.fg ?? segment.fg ?? 'text', 'fg'),
    ` ${text} `
  );
}

function meterValue(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState
): number {
  const expression = segment.value_eval?.trim();
  if (!expression) return ctx.getContextUsage()?.percent ?? 0;

  try {
    const raw = evaluateStatusbarExpression(expression, { segment, ctx, pi, state });
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    return 0;
  }
}

function meterText(
  segment: StatusbarSegmentConfig,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: StatusbarRenderState,
  value: number
): string {
  if (segment.template !== undefined) {
    return renderTemplate(segment.template, meterTokens(value, ctx));
  }

  const expression = segment.eval?.trim();
  if (!expression) return `${Math.round(value)}%`;
  const rendered = safeEvaluateStatusbarExpression(
    expression,
    { segment, ctx, pi, state, value },
    segment.empty_text ?? ''
  );
  return stringifySegmentValue(rendered, segment);
}

function meterTokens(value: number, ctx: ExtensionContext): TemplateTokens {
  return {
    value,
    percent: Math.round(value),
    context_window: maybeHumanReadable(ctx.model?.contextWindow),
  };
}

function meterState(
  value: number,
  segment: StatusbarSegmentConfig
): MeterStateConfig | undefined {
  return (segment.states ?? []).find(
    (stateConfig): stateConfig is MeterStateConfig =>
      isMeterStateConfig(stateConfig) && meterStateMatches(value, stateConfig)
  );
}

function meterStateMatches(value: number, stateConfig: MeterStateConfig): boolean {
  if (typeof stateConfig.gt === 'number' && !(value > stateConfig.gt)) return false;
  if (typeof stateConfig.gte === 'number' && !(value >= stateConfig.gte)) return false;
  if (typeof stateConfig.lt === 'number' && !(value < stateConfig.lt)) return false;
  if (typeof stateConfig.lte === 'number' && !(value <= stateConfig.lte)) return false;
  return true;
}

function isMeterStateConfig(
  stateConfig: StatusStateConfig | MeterStateConfig | GitStateConfig
): stateConfig is MeterStateConfig {
  return (
    ('gt' in stateConfig && typeof stateConfig.gt === 'number') ||
    ('gte' in stateConfig && typeof stateConfig.gte === 'number') ||
    ('lt' in stateConfig && typeof stateConfig.lt === 'number') ||
    ('lte' in stateConfig && typeof stateConfig.lte === 'number')
  );
}

function isGitStateConfig(
  stateConfig: StatusStateConfig | MeterStateConfig | GitStateConfig
): stateConfig is GitStateConfig {
  return 'id' in stateConfig && typeof stateConfig.id === 'string';
}

function isStatusStateConfig(
  stateConfig: StatusStateConfig | MeterStateConfig | GitStateConfig
): stateConfig is StatusStateConfig {
  return 'name' in stateConfig && typeof stateConfig.name === 'string';
}

/** Render one keyed status. Missing keys render nothing. Use key="*" as a catch-all. */
function renderStatusSegment(
  segment: StatusbarSegmentConfig,
  statuses: ReadonlyMap<string, string>,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  renderState: StatusbarRenderState,
  explicitlyConfiguredStatusKeys: ReadonlySet<string>
): string {
  const key = segment.key?.trim();
  if (!key) return '';

  if (key === '*') {
    return Array.from(statuses.entries())
      .filter(([statusKey]) => !explicitlyConfiguredStatusKeys.has(statusKey))
      .map(([statusKey, statusText]) =>
        renderSingleStatusSegment(
          { ...segment, key: statusKey },
          statusText,
          ctx,
          pi,
          renderState
        )
      )
      .join('');
  }

  const statusText = statuses.get(key);
  if (!statusText) return '';
  return renderSingleStatusSegment(segment, statusText, ctx, pi, renderState);
}

function renderSingleStatusSegment(
  segment: StatusbarSegmentConfig,
  statusText: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  renderState: StatusbarRenderState
): string {
  const normalized = normalizeStatus(statusText);
  if (isIgnoredStatus(segment, normalized)) return '';
  const statusStates = (segment.states ?? []).filter(isStatusStateConfig);
  const state = statusStates.find(
    (candidate) => candidate.match && statusMatches(candidate.match, normalized)
  );
  const defaultState = statusStates.find((candidate) => candidate.name === 'default');
  const resolvedState = state ?? defaultState;
  const text = formatStatusSegmentText(
    segment,
    resolvedState,
    normalized,
    ctx,
    pi,
    renderState
  );
  if (!text) return '';

  return renderConfiguredSegment(
    color(resolvedState?.bg ?? segment.bg ?? 'warn', 'bg'),
    color(resolvedState?.fg ?? segment.fg ?? 'text', 'fg'),
    text
  );
}

function renderConfiguredSegment(
  bgRgb: Parameters<typeof renderSegment>[0],
  fgRgb: Parameters<typeof renderSegment>[1],
  text: string
): string {
  return renderSegment(bgRgb, fgRgb, text, config.statusbar.separators);
}

function statusMatches(pattern: string, status: string): boolean {
  return new RegExp(pattern, 'i').test(status);
}

function isIgnoredStatus(segment: StatusbarSegmentConfig, status: string): boolean {
  return segment.ignore?.some((pattern) => statusMatches(pattern, status)) ?? false;
}

function formatStatusSegmentText(
  segment: StatusbarSegmentConfig,
  state: StatusStateConfig | undefined,
  status: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  renderState: StatusbarRenderState
): string {
  const statusContext = parseStatusContext(status, segment.key);
  const displayConfig: StatusbarSegmentConfig = {
    ...segment,
    template: (segment.collapsed_template !== undefined && segment.template === segment.collapsed_template)
      ? segment.collapsed_template
      : (state?.template ?? segment.template),
    eval: (segment.collapsed_eval !== undefined && segment.eval === segment.collapsed_eval)
      ? segment.collapsed_eval
      : (state?.eval ?? segment.eval),
  };
  if (displayConfig.template !== undefined) {
    return renderTemplate(displayConfig.template, statusTokens(statusContext));
  }

  const expression = displayConfig.eval?.trim();


  if (!expression) return ` ${status.trim()} `;

  try {
    return stringifySegmentValue(
      evaluateStatusbarExpression(expression, {
        segment: displayConfig,
        ctx,
        pi,
        state: { ...renderState, status: statusContext },
      }),
      displayConfig
    );
  } catch (error) {
    return ` ${status.trim()} `;
  }
}

function statusTokens(status: Record<string, number | string | boolean>): TemplateTokens {
  const servers = typeof status.text === 'string'
    ? (status.text.match(/(\d+\/\d+)/)?.[1] ?? '')
    : '';
  return {
    ...status,
    value: status.text,
    servers,
  };
}

function parseStatusContext(
  status: string,
  key?: string
): Record<string, number | string | boolean> {
  const context: Record<string, number | string | boolean> = { text: status };
  if (key) context.key = key;
  for (const match of status.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(\d+)/g)) {
    context[match[1] ?? ''] = Number(match[2]);
  }
  for (const match of status.matchAll(/(\d+)\s+([A-Za-z][A-Za-z0-9_-]*)/g)) {
    context[match[2] ?? ''] = Number(match[1]);
  }
  return context;
}

function normalizeStatus(status: string): string {
  return status.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Build the activity segment. Tool usage takes precedence over the streaming
 * "working" spinner. Returns an empty string when there is no activity to
 * display.
 */
function renderActivitySegment(
  state: StatusbarRenderState,
  segment: StatusbarSegmentConfig = { type: 'activity' },
  ctx: ExtensionContext,
  pi: ExtensionAPI
): string {
  const { spinnerFrame, displayedTools, displayedStreaming } = state;
  const sources = segment.sources ?? DEFAULT_ACTIVITY_FIELD.sources;
  const source = sources.find((candidate) => {
    if (candidate === 'tools') return displayedTools.length > 0;
    if (candidate === 'streaming') return displayedStreaming;
    return false;
  });
  if (!source) return '';

  const spinnerFrames = segment.spinner?.frames ?? DEFAULT_ACTIVITY_FIELD.spinner.frames;
  const spinner = spinnerFrames[spinnerFrame] ?? '';
  const tools = displayedTools.join(', ');
  const value =
    segment.values?.[source] ??
    DEFAULT_ACTIVITY_FIELD.values[source] ??
    (source === 'tools' ? tools : '');
  const activity = {
    source,
    spinner,
    tools,
    streaming: displayedStreaming,
    value,
  };
  if (segment.template !== undefined) {
    const minWidth = segment.isCollapsed ? undefined : (segment.min_width ?? DEFAULT_ACTIVITY_FIELD.min_width);
    return renderTextSegment(
      {
        ...segment,
        fg: segment.fg ?? DEFAULT_ACTIVITY_FIELD.fg,
        bg: segment.bg ?? DEFAULT_ACTIVITY_FIELD.bg,
        min_width: minWidth,
      },
      renderTemplate(segment.template, activity)
    );
  }

  const expression = segment.eval?.trim();
  const text = expression
    ? stringifySegmentValue(
        safeEvaluateStatusbarExpression(expression, {
          segment,
          ctx,
          pi,
          state,
          activity,
        }),
        segment
      )
    : `${spinner} ${value}`;

  const minWidth = segment.isCollapsed ? undefined : (segment.min_width ?? DEFAULT_ACTIVITY_FIELD.min_width);
  return renderTextSegment(
    {
      ...segment,
      fg: segment.fg ?? DEFAULT_ACTIVITY_FIELD.fg,
      bg: segment.bg ?? DEFAULT_ACTIVITY_FIELD.bg,
      min_width: minWidth,
    },
    text
  );
}

export function firstActivityField(): StatusbarSegmentConfig {
  return (
    config.statusbar.segments.find((segment) => segment.type === 'activity') ?? {
      type: 'activity',
      ...DEFAULT_ACTIVITY_FIELD,
    }
  );
}
