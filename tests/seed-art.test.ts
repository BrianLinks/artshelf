import { describe, expect, it } from "vitest";
import { generateArtSvg, seededRandom, type Triple } from "../src/seed/art.js";

const COLORS: Triple = ["#7f1d1d", "#dc1414", "#fbbf24"];

describe("seededRandom", () => {
  it("repeats for the same seed and differs for another", () => {
    const sequence = (seed: number) => {
      const next = seededRandom(seed);
      return [next(), next(), next(), next()];
    };
    expect(sequence(7)).toEqual(sequence(7));
    expect(sequence(7)).not.toEqual(sequence(8));
  });

  it("stays in [0, 1)", () => {
    const next = seededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("generateArtSvg", () => {
  it("is deterministic and varies with the seed", () => {
    expect(generateArtSvg(1000, COLORS)).toBe(generateArtSvg(1000, COLORS));
    expect(generateArtSvg(1000, COLORS)).not.toBe(generateArtSvg(1001, COLORS));
  });

  it("produces a complete 800x600 SVG with a fixed number of shapes", () => {
    const svg = generateArtSvg(5, COLORS);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<circle/g)).toHaveLength(14);
    expect(svg.match(/<polygon/g)).toHaveLength(5);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("uses only the given colors", () => {
    const used = new Set([...generateArtSvg(9, COLORS).matchAll(/(?:fill|stop-color)="(#[0-9a-f]{6})"/gi)].map((match) => match[1]));
    for (const color of used) expect(COLORS).toContain(color);
    expect(used.size).toBeGreaterThan(1);
  });

  it("rejects anything that is not a #rrggbb color, so nothing can be injected", () => {
    for (const bad of ["red", "#fff", '#00000"/><script>', "#gggggg", ""]) {
      expect(() => generateArtSvg(1, [bad, "#000000", "#ffffff"])).toThrow(RangeError);
    }
  });
});
