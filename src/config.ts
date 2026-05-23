import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

import { DEFAULT_SEPARATORS, type SegmentSeparators } from './ansi.js';

export interface StatusStateConfig {
  name: string;
  match?: string;
  eval?: string;
  template?: string;
  fg?: string;
  bg: string;
}

type MeterStateNumberKey = keyof Pick<MeterStateConfig, 'gt' | 'gte' | 'lt' | 'lte'>;

const STATUS_STATE_STRING_KEYS = new Set<string>(['name', 'match', 'eval', 'template', 'fg', 'bg']);

const GIT_STATE_IDS = new Set<string>(['unstaged', 'staged', 'ahead', 'behind']);

const METER_STATE_NUMBER_KEYS: readonly MeterStateNumberKey[] = [
  'gt',
  'gte',
  'lt',
  'lte',
];
const METER_STATE_NUMBER_KEY_SET = new Set<string>(METER_STATE_NUMBER_KEYS);

const STATUSBAR_SEGMENT_STRING_KEYS = new Set<string>([
  'fg',
  'bg',
  'eval',
  'template',
  'value_eval',
  'empty_text',
  'show_if',
  'key',
  'format',
  'collapsed_eval',
  'collapsed_template',
]);

const STATUSBAR_SEGMENT_NUMBER_KEYS = new Set<string>([
  'min_duration_ms',
  'min_width',
  'collapse_order',
]);


type StatusbarSegmentType = 'value' | 'meter' | 'status' | 'activity' | 'git';

export interface MeterStateConfig {
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  fg?: string;
  bg?: string;
}

export interface GitStateConfig {
  id: string;
  fg?: string;
  bg?: string;
}

export interface ActivitySpinnerConfig {
  frames: string[];
  interval_ms: number;
}

export type ActivitySource = 'tools' | 'streaming';

export interface GitIconConfig {
  branch?: string;
  remote?: string;
}

export interface StatusbarSegmentConfig {
  type: StatusbarSegmentType;
  fg?: string;
  bg?: string;
  eval?: string;
  template?: string;
  value_eval?: string;
  states?: Array<StatusStateConfig | MeterStateConfig | GitStateConfig>;
  empty_text?: string;
  show_if?: string;
  values?: Partial<Record<ActivitySource, string>>;
  icons?: GitIconConfig;
  sources?: ActivitySource[];
  spinner?: ActivitySpinnerConfig;
  min_duration_ms?: number;
  min_width?: number;
  key?: string;
  format?: string;
  ignore?: string[];
  collapse_order?: number;
  collapsed_eval?: string;
  collapsed_template?: string;
  isCollapsed?: boolean;
}


interface StatusbarConfig {
  separators: SegmentSeparators;
  segments: StatusbarSegmentConfig[];
}

export interface PiBarConfig {
  colors: Record<string, string>;
  statusbar: StatusbarConfig;
}

type Section =
  | 'root'
  | 'colors'
  | 'statusbar'
  | 'statusbar_separators'
  | 'statusbar_segment'
  | 'statusbar_segment_state';

export const DEFAULT_ACTIVITY_FIELD: Required<
  Pick<
    StatusbarSegmentConfig,
    | 'fg'
    | 'bg'
    | 'values'
    | 'sources'
    | 'spinner'
    | 'min_duration_ms'
    | 'min_width'
  >
> = {
  fg: 'activity_fg',
  bg: 'activity_bg',
  values: { streaming: 'working' },
  sources: ['tools', 'streaming'],
  spinner: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    interval_ms: 100,
  },
  min_duration_ms: 1000,
  min_width: 11,
};

function defaultColors(): Record<string, string> {
  return {
    text_fg: '#cdd6f4',
    model_bg: '#005b95',
    thinking_bg: '#005b95',
    git_bg: '#313244',
    lsp_bg: '#313244',
    activity_bg: '#313244',
    activity_fg: '#2dd4bf',
    ok: '#006b1d',
    warn: '#a17a00',
    alert: '#972e2d',
  };
}

function defaultConfig(): PiBarConfig {
  return {
    colors: defaultColors(),
    statusbar: {
      separators: DEFAULT_SEPARATORS,
      segments: [
        {
          type: 'value',
          template: '  {model}',
          fg: 'text_fg',
          bg: 'model_bg',
          empty_text: 'no model',
          collapse_order: 3,
          collapsed_template: '  {short_model}',
        },
        {
          type: 'value',
          template: '{thinking}',
          fg: 'text_fg',
          bg: 'thinking_bg',
          show_if: 'model?.reasoning',
          collapse_order: 2,
        },
        {
          type: 'meter',
          template: '{percent}% of {context_window}',
          value_eval: 'ctx.getContextUsage()?.percent ?? 0',
          fg: 'text_fg',
          states: [
            { gte: 75, bg: 'alert' },
            { gte: 50, bg: 'warn' },
            { gte: 0, bg: 'ok' },
          ],
          collapse_order: 4,
          collapsed_template: '{percent}%',
        },
        {
          type: 'git',
          template: ' {remote_icon}{branch_icon}{branch} ',
          fg: 'text_fg',
          bg: 'git_bg',
          collapse_order: 3,
          collapsed_template: ' {branch} ',
        },
        {
          type: 'status',
          key: 'whatsapp',
          template: '  ',
          fg: 'text_fg',
          states: [{ name: 'default', bg: 'warn' }],
          collapse_order: 1,
        },
        {
          type: 'status',
          key: 'lsp',
          template: ' LSP ',
          fg: 'text_fg',
          states: [{ name: 'default', bg: 'warn' }],
          collapse_order: 2,
        },
        {
          type: 'status',
          key: '*',
          template: ' {text} ',
          fg: 'text_fg',
          ignore: ['^Codex adapter\\b'],
          states: [{ name: 'default', bg: 'warn' }],
          collapse_order: 1,
        },
        {
          type: 'activity',
          ...DEFAULT_ACTIVITY_FIELD,
          collapse_order: 5,
          template: '{spinner} {value}',
          collapsed_template: '{spinner}',
        },
      ],
    },
  };
}

function userConfigPath(): string {
  return join(homedir(), '.pi', 'pi-bar', 'config.toml');
}

function bundledConfigPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config.toml');
}

function parseStringValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    throw new Error(`Unsupported TOML string value: ${raw}`);
  }
  return JSON.parse(trimmed) as string;
}

function parseArrayValue(
  raw: string
): string[] | Array<StatusStateConfig | MeterStateConfig | GitStateConfig> {
  const trimmed = raw.trim();
  if (hasInlineTableArray(trimmed)) return parseInlineTableArray(trimmed);

  const value: unknown = JSON.parse(trimmed);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Unsupported TOML array value: ${raw}`);
  }
  return value;
}

function hasInlineTableArray(raw: string): boolean {
  return findUnquotedChar(raw, '{') !== -1;
}

function parseInlineTableArray(raw: string): Array<StatusStateConfig | MeterStateConfig | GitStateConfig> {
  const items = splitTopLevelArrayItems(raw).map((itemRaw) => {
    const body = inlineTableBody(itemRaw);
    const item: Partial<StatusStateConfig & MeterStateConfig & GitStateConfig> = {};
    for (const part of splitTopLevelFields(body)) {
      const field = /^(?<key>[A-Za-z0-9_]+)\s*=\s*(?<value>.+)$/.exec(part.trim());
      if (!field?.groups) throw new Error(`Unsupported TOML inline table: {${body}}`);
      const value = parseValue(field.groups.value);
      if (METER_STATE_NUMBER_KEY_SET.has(field.groups.key)) {
        if (typeof value !== 'number') {
          throw new Error(`State ${field.groups.key} must be a number`);
        }
        setMeterStateNumber(item, field.groups.key, value);
      } else if (field.groups.key === 'id') {
        if (typeof value !== 'string') {
          throw new Error('State id must be a string');
        }
        setGitStateId(item, value);
      } else if (STATUS_STATE_STRING_KEYS.has(field.groups.key)) {
        if (typeof value !== 'string') {
          throw new Error(`State ${field.groups.key} must be a string`);
        }
        setStatusStateString(item, field.groups.key, value);
      } else {
        throw new Error(`Unsupported state key: ${field.groups.key}`);
      }
    }

    const hasMeterMatcher = METER_STATE_NUMBER_KEYS.some(
      (key) => typeof item[key] === 'number'
    );
    if (hasMeterMatcher) return item as MeterStateConfig;
    if (typeof item.id === 'string' && GIT_STATE_IDS.has(item.id)) return item as GitStateConfig;
    if (typeof item.name === 'string' && typeof item.bg === 'string') {
      return item as StatusStateConfig;
    }

    throw new Error('State requires either gt/gte/lt/lte, id, or name and bg');
  });
  if (items.length === 0) throw new Error(`Unsupported TOML array value: ${raw}`);
  return items;
}

function parseInlineTable(raw: string): Record<string, unknown> {
  const body = inlineTableBody(raw);
  const item: Record<string, unknown> = {};
  for (const part of splitTopLevelFields(body)) {
    const field = /^(?<key>[A-Za-z0-9_]+)\s*=\s*(?<value>.+)$/.exec(part.trim());
    if (!field?.groups) throw new Error(`Unsupported TOML inline table: {${body}}`);
    item[field.groups.key] = parseValue(field.groups.value);
  }
  return item;
}

function splitTopLevelArrayItems(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error(`Unsupported TOML array value: ${raw}`);
  }
  return splitTopLevelFields(trimmed.slice(1, -1)).filter(Boolean);
}

function inlineTableBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(`Unsupported TOML inline table: ${raw}`);
  }
  return trimmed.slice(1, -1);
}

function splitTopLevelFields(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  scanUnquotedChars(raw, (char, index) => {
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
    if (char !== ',' || depth !== 0) return;

    parts.push(raw.slice(start, index).trim());
    start = index + 1;
  });

  const last = raw.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function findUnquotedChar(raw: string, target: string): number {
  let foundIndex = -1;
  scanUnquotedChars(raw, (char, index) => {
    if (foundIndex === -1 && char === target) foundIndex = index;
  });
  return foundIndex;
}

function scanUnquotedChars(
  raw: string,
  visit: (char: string, index: number) => void
): void {
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '"') {
      i = skipQuotedString(raw, i);
      continue;
    }
    visit(char, i);
  }
}

function skipQuotedString(raw: string, start: number): number {
  for (let i = start + 1; i < raw.length; i += 1) {
    if (raw[i] === '\\') {
      i += 1;
      continue;
    }
    if (raw[i] === '"') return i;
  }
  return raw.length - 1;
}

function bracketDelta(value: string): number {
  return (value.match(/\[/g)?.length ?? 0) - (value.match(/]/g)?.length ?? 0);
}

function parseValue(
  raw: string
):
  | string
  | number
  | boolean
  | string[]
  | Array<StatusStateConfig | MeterStateConfig | GitStateConfig>
  | Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.startsWith('[')) return parseArrayValue(trimmed);
  if (trimmed.startsWith('{')) return parseInlineTable(trimmed);
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  return parseStringValue(trimmed);
}

function assertSegmentType(value: unknown): asserts value is StatusbarSegmentType {
  const valid = ['value', 'meter', 'status', 'activity', 'git'];
  if (typeof value !== 'string' || !valid.includes(value)) {
    throw new Error(
      `Unsupported status bar segment type: ${String(value)}. Supported: ${valid.join(', ')}`
    );
  }
}

function setMeterStateNumber(
  state: Partial<StatusStateConfig & MeterStateConfig & GitStateConfig>,
  key: string,
  value: number
): void {
  switch (key) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      state[key] = value;
      return;
    default:
      throw new Error(`Unsupported meter state key: ${key}`);
  }
}

function setGitStateId(
  state: Partial<StatusStateConfig & MeterStateConfig & GitStateConfig>,
  value: string
): void {
  if (!GIT_STATE_IDS.has(value)) {
    throw new Error(`Unsupported git state id: ${value}`);
  }
  state.id = value;
}

function setStatusStateString(
  state: Partial<StatusStateConfig> | StatusStateConfig,
  key: string,
  value: string
): void {
  switch (key) {
    case 'name':
    case 'match':
    case 'eval':
    case 'template':
    case 'fg':
    case 'bg':
      state[key] = value;
      return;
    default:
      throw new Error(`Unsupported status state key: ${key}`);
  }
}

function setStatusBarSegmentString(
  segment: StatusbarSegmentConfig,
  key: string,
  value: string
): void {
  switch (key) {
    case 'fg':
    case 'bg':
    case 'eval':
    case 'template':
    case 'value_eval':
    case 'empty_text':
    case 'show_if':
    case 'key':
    case 'format':
    case 'collapsed_eval':
    case 'collapsed_template':
      segment[key] = value;
      return;
    default:
      throw new Error(`Unsupported status bar segment key: ${key}`);
  }
}

function setStatusBarSegmentNumber(
  segment: StatusbarSegmentConfig,
  key: string,
  value: number
): void {
  switch (key) {
    case 'min_duration_ms':
    case 'min_width':
    case 'collapse_order':
      segment[key] = value;
      return;
    default:
      throw new Error(`Unsupported status bar segment key: ${key}`);
  }
}

function isActivitySource(value: unknown): value is ActivitySource {
  return value === 'tools' || value === 'streaming';
}

function parseActivityValues(value: unknown): Partial<Record<ActivitySource, string>> {
  if (!isRecord(value))
    throw new Error('Status bar segment values must be an inline table');

  const values: Partial<Record<ActivitySource, string>> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!isActivitySource(key)) throw new Error(`Unsupported activity value key: ${key}`);
    if (typeof fieldValue !== 'string') {
      throw new Error(`Status bar segment values.${key} must be a string`);
    }
    values[key] = fieldValue;
  }
  return values;
}

function parseActivitySpinner(value: unknown): ActivitySpinnerConfig {
  if (!isRecord(value))
    throw new Error('Status bar segment spinner must be an inline table');

  const frames = value.frames;
  const intervalMs = value.interval_ms;
  if (!Array.isArray(frames) || !frames.every((item) => typeof item === 'string')) {
    throw new Error('Status bar segment spinner.frames must be a string array');
  }
  if (typeof intervalMs !== 'number') {
    throw new Error('Status bar segment spinner.interval_ms must be a number');
  }
  return { frames, interval_ms: intervalMs };
}

function parseGitIcons(value: unknown): GitIconConfig {
  if (!isRecord(value))
    throw new Error('Status bar segment icons must be an inline table');

  const icons: GitIconConfig = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (key !== 'branch' && key !== 'remote') {
      throw new Error(`Unsupported git icon key: ${key}`);
    }
    if (typeof fieldValue !== 'string') {
      throw new Error(`Status bar segment icons.${key} must be a string`);
    }
    icons[key] = fieldValue;
  }
  return icons;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assignStatusbarSegmentValue(
  segment: StatusbarSegmentConfig,
  key: string,
  value: ReturnType<typeof parseValue>
): void {
  if (key === 'type') {
    assertSegmentType(value);
    segment.type = value;
    return;
  }

  if (STATUSBAR_SEGMENT_STRING_KEYS.has(key)) {
    if (typeof value !== 'string')
      throw new Error(`Status bar segment ${key} must be a string`);
    setStatusBarSegmentString(segment, key, value);
    return;
  }

  if (STATUSBAR_SEGMENT_NUMBER_KEYS.has(key)) {
    if (typeof value !== 'number')
      throw new Error(`Status bar segment ${key} must be a number`);
    setStatusBarSegmentNumber(segment, key, value);
    return;
  }

  if (key === 'sources') {
    if (!Array.isArray(value) || !value.every(isActivitySource)) {
      throw new Error('Status bar segment sources must be an activity source array');
    }
    segment.sources = value;
    return;
  }

  if (key === 'ignore') {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      throw new Error('Status bar segment ignore must be a string array');
    }
    segment.ignore = value;
    return;
  }

  if (key === 'values') {
    segment.values = parseActivityValues(value);
    return;
  }

  if (key === 'icons') {
    segment.icons = parseGitIcons(value);
    return;
  }

  if (key === 'spinner') {
    segment.spinner = parseActivitySpinner(value);
    return;
  }

  if (key === 'states') {
    if (!Array.isArray(value) || value.every((item) => typeof item === 'string')) {
      throw new Error('Status bar segment states must be an inline table array');
    }
    segment.states = value;
    return;
  }

  throw new Error(`Unsupported status bar segment key: ${key}`);
}

function assignStatusStateValue(
  state: StatusStateConfig,
  key: string,
  value: ReturnType<typeof parseValue>
): void {
  if (!STATUS_STATE_STRING_KEYS.has(key)) {
    throw new Error(`Unsupported status state key: ${key}`);
  }
  if (typeof value !== 'string') throw new Error(`Status state ${key} must be a string`);
  setStatusStateString(state, key, value);
}

function parseConfigToml(source: string): PiBarConfig {
  const config = defaultConfig();
  config.statusbar.segments = [];

  let section: Section = 'root';
  let currentStatusbarSegment: StatusbarSegmentConfig | null = null;
  let currentState: StatusStateConfig | null = null;

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let rawLine = lines[i] ?? '';
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line === '[colors]') {
      section = 'colors';
      currentStatusbarSegment = null;
      currentState = null;
      continue;
    }

    if (line === '[statusbar]') {
      section = 'statusbar';
      currentStatusbarSegment = null;
      currentState = null;
      continue;
    }

    if (line === '[statusbar.separators]') {
      section = 'statusbar_separators';
      currentStatusbarSegment = null;
      currentState = null;
      continue;
    }

    if (line === '[[statusbar.segments]]') {
      currentStatusbarSegment = { type: 'value', eval: "''" };
      config.statusbar.segments.push(currentStatusbarSegment);
      section = 'statusbar_segment';
      currentState = null;
      continue;
    }

    if (line === '[[statusbar.segments.states]]') {
      if (!currentStatusbarSegment) {
        throw new Error(
          'TOML status bar segment state declared before status bar segment'
        );
      }
      currentState = { name: '', bg: '' };
      currentStatusbarSegment.states ??= [];
      currentStatusbarSegment.states.push(currentState);
      section = 'statusbar_segment_state';
      continue;
    }

    let match = /^(?<key>[A-Za-z0-9_]+)\s*=\s*(?<value>.+)$/.exec(line);
    if (match?.groups && match.groups.value.trim().startsWith('[')) {
      let balance = bracketDelta(match.groups.value);
      while (balance > 0 && i + 1 < lines.length) {
        i += 1;
        const nextLine = (lines[i] ?? '').trim();
        rawLine += `\n${lines[i] ?? ''}`;
        line += ` ${nextLine}`;
        balance += bracketDelta(nextLine);
      }
      match = /^(?<key>[A-Za-z0-9_]+)\s*=\s*(?<value>.+)$/.exec(line);
    }
    if (!match?.groups) {
      throw new Error(`Unsupported TOML line: ${rawLine}`);
    }

    const key = match.groups.key;
    const value = parseValue(match.groups.value);

    if (section === 'colors') {
      if (typeof value !== 'string') throw new Error(`Color ${key} must be a string`);
      config.colors[key] = value;
    } else if (section === 'statusbar') {
      throw new Error(`Unsupported status bar key: ${key}`);
    } else if (section === 'statusbar_separators') {
      if (typeof value !== 'string') {
        throw new Error(`Status bar separator ${key} must be a string`);
      }
      if (key === 'leading' || key === 'trailing') {
        config.statusbar.separators[key] = value;
      } else {
        throw new Error(`Unsupported status bar separator key: ${key}`);
      }
    } else if (section === 'statusbar_segment' && currentStatusbarSegment) {
      assignStatusbarSegmentValue(currentStatusbarSegment, key, value);
    } else if (section === 'statusbar_segment_state' && currentState) {
      assignStatusStateValue(currentState, key, value);
    } else {
      throw new Error(`TOML key outside supported section: ${key}`);
    }
  }

  if (config.statusbar.segments.length === 0) {
    config.statusbar.segments = defaultConfig().statusbar.segments;
  }

  for (const segment of config.statusbar.segments) {
    assertSegmentType(segment.type);
  }

  for (const segment of config.statusbar.segments) {
    if (segment.states?.length === 0) delete segment.states;
  }
  return config;
}

function loadConfig(): PiBarConfig {
  for (const path of [userConfigPath(), bundledConfigPath()]) {
    try {
      if (existsSync(path)) return parseConfigToml(readFileSync(path, 'utf8'));
    } catch {
      // Try the next config source before falling back to built-in defaults.
    }
  }

  return defaultConfig();
}

export const config = loadConfig();
