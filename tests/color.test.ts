import { describe, expect, it } from "vitest";
import {
  deltaE,
  extractPalette,
  paletteSimilarity,
  parseHex,
  similarityScore,
  solidPalette,
  toHex,
} from "../src/search/color.js";

const solid = (r: number, g: number, b: number, pixels: number): Uint8Array => {
  const data = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) data.set([r, g, b], i * 3);
  return data;
};
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const RED = { r: 255, g: 0, b: 0 };
const ORANGE = { r: 255, g: 140, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

describe("hex colors", () => {
  it("parses short and long forms, with or without #", () => {
    expect(parseHex("#F00")).toEqual(RED);
    expect(parseHex("00ff80")).toEqual({ r: 0, g: 255, b: 128 });
    expect(parseHex("  #0000ff ")).toEqual(BLUE);
  });

  it.each(["red", "#12", "#gggggg", "", "#12345", "1234567", "rgb(1,2,3)"])("rejects %j", (input) => {
    expect(parseHex(input)).toBeUndefined();
  });

  it("formats with zero padding", () => {
    expect(toHex({ r: 220, g: 20, b: 5 })).toBe("#dc1405");
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
  });
});

describe("palette extraction", () => {
  it("returns the exact color of a solid image", () => {
    expect(extractPalette(solid(220, 20, 20, 1024), 3)).toEqual([{ r: 220, g: 20, b: 20, weightBps: 10_000 }]);
  });

  it("splits weight by how much of the image each color covers", () => {
    const palette = extractPalette(join(solid(0, 255, 0, 700), solid(255, 255, 0, 200), solid(0, 0, 0, 100)), 3);
    expect(palette.map((color) => color.g)).toEqual([255, 255, 0]);
    expect(palette[0]).toMatchObject({ r: 0, weightBps: 7_000 });
    expect(palette[1]).toMatchObject({ r: 255, weightBps: 2_000 });
    expect(palette.reduce((sum, color) => sum + color.weightBps, 0)).toBe(10_000);
  });

  it("always sums to 10000, even when shares do not divide evenly", () => {
    const palette = extractPalette(join(solid(255, 0, 0, 3), solid(0, 255, 0, 3), solid(0, 0, 255, 3)), 3);
    expect(palette).toHaveLength(3);
    expect(palette.reduce((sum, color) => sum + color.weightBps, 0)).toBe(10_000);
    for (const color of palette) expect(color.weightBps).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic, including for ties", () => {
    const pixels = join(solid(255, 0, 0, 512), solid(0, 0, 255, 512));
    expect(extractPalette(pixels, 3)).toEqual(extractPalette(pixels, 3));
    expect(extractPalette(pixels, 3).map((color) => color.weightBps)).toEqual([5_000, 5_000]);
  });

  it("keeps at most five colors, most common first", () => {
    const noisy = new Uint8Array(Array.from({ length: 6_000 }, (_, index) => (index * 37) % 256));
    const palette = extractPalette(noisy, 3);
    expect(palette.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < palette.length; i++) {
      expect((palette[i - 1] as { weightBps: number }).weightBps).toBeGreaterThanOrEqual((palette[i] as { weightBps: number }).weightBps);
    }
  });

  it("ignores an alpha channel", () => {
    const rgba = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 128, 10, 20, 30, 0]);
    expect(extractPalette(rgba, 4)).toEqual([{ r: 10, g: 20, b: 30, weightBps: 10_000 }]);
  });

  it("handles empty input and rejects too few channels", () => {
    expect(extractPalette(new Uint8Array(0), 3)).toEqual([]);
    expect(() => extractPalette(new Uint8Array(4), 2)).toThrow(RangeError);
  });
});

describe("color distance and similarity", () => {
  it("measures perceptual distance", () => {
    expect(deltaE(RED, RED)).toBe(0);
    expect(deltaE(RED, { r: 250, g: 5, b: 5 })).toBeLessThan(5);
    expect(deltaE(RED, ORANGE)).toBeLessThan(deltaE(RED, BLUE));
    expect(deltaE(RED, BLUE)).toBeGreaterThan(100);
    expect(deltaE({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(100, 0);
  });

  it("scores identical palettes 1000 and unrelated ones 0", () => {
    expect(similarityScore(solidPalette(RED), solidPalette(RED))).toBe(1000);
    expect(similarityScore(solidPalette(RED), solidPalette(BLUE))).toBe(0);
  });

  it("is symmetric and ranks nearer colors higher", () => {
    expect(paletteSimilarity(solidPalette(RED), solidPalette(ORANGE))).toBeCloseTo(paletteSimilarity(solidPalette(ORANGE), solidPalette(RED)), 10);
    const nearRed = { r: 235, g: 20, b: 20 };
    expect(similarityScore(solidPalette(RED), solidPalette(nearRed))).toBeGreaterThan(similarityScore(solidPalette(RED), solidPalette(ORANGE)));
  });

  it("rewards palettes that share their main colors", () => {
    const reds = extractPalette(join(solid(220, 20, 20, 800), solid(240, 240, 240, 200)), 3);
    const redsAgain = extractPalette(join(solid(222, 22, 22, 700), solid(30, 30, 30, 300)), 3);
    const blues = extractPalette(join(solid(20, 20, 220, 800), solid(240, 240, 240, 200)), 3);
    expect(paletteSimilarity(reds, redsAgain)).toBeGreaterThan(paletteSimilarity(reds, blues));
  });

  it("scores nothing for an empty palette", () => {
    expect(similarityScore(solidPalette(RED), [])).toBe(0);
  });
});
