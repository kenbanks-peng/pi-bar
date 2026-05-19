import { config } from './config.js';

export type RGB = readonly [number, number, number];

const colorVars: Record<string, string> = config.colors;
const FALLBACK_BG: RGB = [49, 50, 68];
const FALLBACK_FG: RGB = [205, 214, 244];

function getColor(colorName: string, seen = new Set<string>()): string | undefined {
  const color = colorVars[colorName];
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  if (seen.has(colorName)) return undefined;

  seen.add(colorName);
  return getColor(color, seen);
}

function hexToRgb(colorName: string): RGB | undefined {
  const hex = getColor(colorName);
  if (!hex) return undefined;

  const match = /^#(?<r>[0-9a-f]{2})(?<g>[0-9a-f]{2})(?<b>[0-9a-f]{2})$/i.exec(hex);
  if (!match?.groups) return undefined;

  return [
    Number.parseInt(match.groups.r, 16),
    Number.parseInt(match.groups.g, 16),
    Number.parseInt(match.groups.b, 16),
  ];
}

export function color(name: string, fallback: 'bg' | 'fg' = 'fg'): RGB {
  return hexToRgb(name) ?? (fallback === 'bg' ? FALLBACK_BG : FALLBACK_FG);
}
