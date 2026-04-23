/**
 * CSS variables that are specifically for vibrancy/blur backgrounds.
 * Only these variables will have their rgba values blended when vibrancy is disabled.
 */
const VIBRANCY_RELATED_VARS = new Set([
  "--color-background",
  "--color-muted",
  "--color-popover",
  "--color-card",
  "--color-input",
  "--color-secondary",
  "--color-accent",
]);

const ALPHA_COMPENSATION_CONFIG = {
  windowsFactor: 0.3,
  maxAlpha: 0.92,
  alphaThreshold: 0.9,
} as const;

const VIBRANCY_DEFAULT_ALPHA: Readonly<Record<string, number>> = {
  "--color-background": 0.35,
  "--color-muted": 0.4,
  "--color-card": 0.72,
  "--color-popover": 0.78,
  "--color-input": 0.58,
  "--color-secondary": 0.47,
  "--color-accent": 0.58,
};

export interface VibrancyColorOptions {
  vibrancyEnabled: boolean;
  isDarkTheme: boolean;
  isMac: boolean;
}

function compensateAlphaForPlatform(alpha: number, isMac: boolean): number {
  if (isMac) return alpha;

  const { windowsFactor, maxAlpha, alphaThreshold } = ALPHA_COMPENSATION_CONFIG;
  if (alpha >= alphaThreshold) return alpha;
  const compensated = alpha + (1 - alpha) * windowsFactor;
  return Math.min(compensated, maxAlpha);
}

function blendRgbaWithBackground(
  r: number,
  g: number,
  b: number,
  a: number,
  isDarkTheme: boolean,
): string {
  const bgR = isDarkTheme ? 11 : 252;
  const bgG = isDarkTheme ? 12 : 253;
  const bgB = isDarkTheme ? 15 : 253;

  const outR = Math.round(r * a + bgR * (1 - a));
  const outG = Math.round(g * a + bgG * (1 - a));
  const outB = Math.round(b * a + bgB * (1 - a));

  return `rgb(${outR}, ${outG}, ${outB})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim().replace(/^#/, "");
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    };
  }
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return null;
}

export function processColorForVibrancy(
  varName: string,
  value: string,
  { vibrancyEnabled, isDarkTheme, isMac }: VibrancyColorOptions,
): string {
  if (!VIBRANCY_RELATED_VARS.has(varName)) {
    return value;
  }

  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    if (!vibrancyEnabled) return value;

    const rgb = hexToRgb(value);
    if (!rgb) return value;

    const defaultAlpha = VIBRANCY_DEFAULT_ALPHA[varName] ?? 0.6;
    const compensatedAlpha = compensateAlphaForPlatform(defaultAlpha, isMac);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${compensatedAlpha.toFixed(3)})`;
  }

  const rgbaMatch = value.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i);
  if (!rgbaMatch) {
    return value;
  }

  const r = Number.parseInt(rgbaMatch[1], 10);
  const g = Number.parseInt(rgbaMatch[2], 10);
  const b = Number.parseInt(rgbaMatch[3], 10);
  const originalAlpha = Number.parseFloat(rgbaMatch[4]);

  if (!vibrancyEnabled) {
    return blendRgbaWithBackground(r, g, b, originalAlpha, isDarkTheme);
  }

  const compensatedAlpha = compensateAlphaForPlatform(originalAlpha, isMac);
  if (compensatedAlpha === originalAlpha) {
    return value;
  }

  return `rgba(${r}, ${g}, ${b}, ${compensatedAlpha})`;
}
