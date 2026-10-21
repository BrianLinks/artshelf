/** Deterministic color analysis: palette extraction and perceptual distance. No external services. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface PaletteColor extends RGB {
  /** Share of the palette's pixels, in basis points. A palette's weights sum to 10000. */
  weightBps: number;
}

export const MAX_PALETTE_COLORS = 5;

export function parseHex(input: string): RGB | undefined {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) return undefined;
  let hex = (match[1] as string).toLowerCase();
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join("");
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}

export function toHex(color: RGB): string {
  return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Groups pixels into 4096 bins (4 bits per channel), keeps the most common bins and reports each bin's true mean
 * color. Ties break by bin number, so the same pixels always give the same palette.
 */
export function extractPalette(pixels: Uint8Array, channels: number, maxColors: number = MAX_PALETTE_COLORS): PaletteColor[] {
  if (channels < 3) throw new RangeError("Pixel data needs at least three channels");
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset + channels <= pixels.length; offset += channels) {
    const r = pixels[offset] as number;
    const g = pixels[offset + 1] as number;
    const b = pixels[offset + 2] as number;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
  }
  const top = [...bins.entries()].sort((a, b) => b[1].count - a[1].count || a[0] - b[0]).slice(0, maxColors);
  const total = top.reduce((sum, [, bin]) => sum + bin.count, 0);
  if (total === 0) return [];
  const palette = top.map(([, bin]) => ({
    r: Math.round(bin.r / bin.count),
    g: Math.round(bin.g / bin.count),
    b: Math.round(bin.b / bin.count),
    weightBps: Math.max(1, Math.floor((bin.count * 10_000) / total)),
  }));
  const assigned = palette.reduce((sum, color) => sum + color.weightBps, 0);
  const first = palette[0] as PaletteColor;
  first.weightBps += 10_000 - assigned; // rounding remainder goes to the most common color
  return palette;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toLab(color: RGB): [number, number, number] {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 distance between two colors: 0 means identical, around 2 is barely noticeable, 100 is very different. */
export function deltaE(a: RGB, b: RGB): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** Colors further apart than this count as unrelated. */
export const UNRELATED_DELTA_E = 50;

function closeness(distance: number): number {
  return Math.max(0, 1 - distance / UNRELATED_DELTA_E);
}

function directional(from: readonly PaletteColor[], to: readonly PaletteColor[]): number {
  const total = from.reduce((sum, color) => sum + color.weightBps, 0);
  if (total === 0 || to.length === 0) return 0;
  let score = 0;
  for (const color of from) {
    const nearest = Math.min(...to.map((other) => deltaE(color, other)));
    score += (color.weightBps / total) * closeness(nearest);
  }
  return score;
}

/** How alike two palettes look, from 0 to 1. Symmetric: each color is matched to its nearest color on the other side. */
export function paletteSimilarity(a: readonly PaletteColor[], b: readonly PaletteColor[]): number {
  return (directional(a, b) + directional(b, a)) / 2;
}

/** A single wanted color as a palette. */
export function solidPalette(color: RGB): PaletteColor[] {
  return [{ ...color, weightBps: 10_000 }];
}

/** Integer score from 0 to 1000, so rankings do not depend on tiny floating point differences. */
export function similarityScore(a: readonly PaletteColor[], b: readonly PaletteColor[]): number {
  return Math.round(paletteSimilarity(a, b) * 1000);
}
