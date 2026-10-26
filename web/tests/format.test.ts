import { describe, expect, it } from "vitest";
import {
  colorParam,
  formatCents,
  formatDate,
  humanize,
  isHexColor,
  normalizeColor,
  parseDollarsToCents,
  starParts,
  toColorInputValue,
} from "../src/lib/format.js";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [50_000, "$500.00"],
    [123_456_789, "$1,234,567.89"],
    [-1_250, "-$12.50"],
    [99, "$0.99"],
  ])("formats %d as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["12", 1_200],
    ["12.5", 1_250],
    ["12.05", 1_205],
    ["$1,200.05", 120_005],
    ["  7 ", 700],
    ["0.99", 99],
  ])("parses %j as %d", (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1.234", "1,00", "$", ".5", "1e3", "12.", "1,2345"])("rejects %j", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats in UTC", () => {
    expect(formatDate("2026-10-21T23:59:59.000Z")).toBe("21 Oct 2026");
    expect(formatDate("2026-01-01T00:00:00.000Z")).toBe("1 Jan 2026");
  });
  it("returns an empty string for nonsense", () => {
    expect(formatDate("not a date")).toBe("");
  });
});

describe("starParts", () => {
  it.each([
    [null, { full: 0, half: false, empty: 5 }],
    [5, { full: 5, half: false, empty: 0 }],
    [4.5, { full: 4, half: true, empty: 0 }],
    [4.3, { full: 4, half: true, empty: 0 }], // nearest half star
    [4.2, { full: 4, half: false, empty: 1 }],
    [3.8, { full: 4, half: false, empty: 1 }],
    [3.7, { full: 3, half: true, empty: 1 }],
    [1, { full: 1, half: false, empty: 4 }],
    [0, { full: 0, half: false, empty: 5 }],
  ])("splits %s into stars", (average, expected) => {
    expect(starParts(average)).toEqual(expected);
  });

  it("always adds up to five", () => {
    for (let tenths = 0; tenths <= 50; tenths++) {
      const { full, half, empty } = starParts(tenths / 10);
      expect(full + (half ? 1 : 0) + empty).toBe(5);
    }
  });
});

describe("small helpers", () => {
  it("humanizes codes", () => {
    expect(humanize("non_commercial")).toBe("Non commercial");
    expect(humanize("resale_as_is")).toBe("Resale as is");
    expect(humanize("")).toBe("");
  });

  it("handles colors", () => {
    expect(colorParam("#DC1414")).toBe("dc1414");
    expect(isHexColor("#f00")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(normalizeColor("#DC1414")).toBe("dc1414");
    expect(normalizeColor("nope")).toBe("");
  });
});

describe("toColorInputValue", () => {
  it("expands short hex and adds the #", () => {
    expect(toColorInputValue("f00")).toBe("#ff0000");
    expect(toColorInputValue("DC1414")).toBe("#dc1414");
    expect(toColorInputValue("#0A0")).toBe("#00aa00");
  });
  it("falls back for empty or invalid input", () => {
    expect(toColorInputValue("")).toBe("#dc1414");
    expect(toColorInputValue("red")).toBe("#dc1414");
  });
});
