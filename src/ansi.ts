/**
 * Low-level ANSI / powerline rendering primitives.
 *
 * Keeps all ESC-sequence emission in one place so the rest of the code can
 * stay in terms of `renderSegment(bg, fg, text)`.
 */

import type { RGB } from './palette.js';

export interface SegmentSeparators {
  leading: string;
  trailing: string;
}

export const RESET = '\x1b[0m';

export const fg = (rgb: RGB): string => `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
export const bg = (rgb: RGB): string => `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;

export const DEFAULT_SEPARATORS: SegmentSeparators = {
  leading: '\uE0BA',
  trailing: '\uE0BC',
};

/** Render a single colored segment with configured separators. */
export function renderSegment(
  bgRgb: RGB,
  fgRgb: RGB,
  text: string,
  separators: SegmentSeparators = DEFAULT_SEPARATORS
): string {
  return (
    fg(bgRgb) +
    separators.leading +
    RESET +
    bg(bgRgb) +
    fg(fgRgb) +
    text +
    RESET +
    fg(bgRgb) +
    separators.trailing +
    RESET
  );
}

/** Calculate the printed visual width of a string by stripping ANSI escape sequences. */
export function visualLength(str: string): number {
  return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').length;
}

