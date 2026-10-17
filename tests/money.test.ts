import { describe, expect, it } from "vitest";
import { cents, formatCents, parseDollars, percentOf, splitCommission } from "../src/money.js";

describe("cents", () => {
  it("accepts integers", () => {
    expect(cents(50_000)).toBe(50_000);
  });

  it.each([0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects %s", (value) => {
    expect(() => cents(value)).toThrow(RangeError);
  });
});

describe("parseDollars", () => {
  it.each([
    ["500", 50_000],
    ["500.5", 50_050],
    ["500.05", 50_005],
    ["0.99", 99],
    ["-12.30", -1_230],
    ["  7 ", 700],
    ["-0", 0],
  ])("parses %s", (input, expected) => {
    expect(parseDollars(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "1,000", "$5", "1e3", "--5", ".5"])("rejects %j", (input) => {
    expect(() => parseDollars(input)).toThrow(RangeError);
  });
});

describe("formatCents", () => {
  it("formats with grouping and two decimals", () => {
    expect(formatCents(cents(50_000))).toBe("$500.00");
    expect(formatCents(cents(123_456_789))).toBe("$1,234,567.89");
    expect(formatCents(cents(5))).toBe("$0.05");
  });

  it("formats negatives", () => {
    expect(formatCents(cents(-1_250))).toBe("-$12.50");
  });
});

describe("percentOf", () => {
  it("rounds half up", () => {
    expect(percentOf(cents(1_005), 1_000)).toBe(101); // 100.5 -> 101
    expect(percentOf(cents(999), 1_500)).toBe(150); // 149.85 -> 150
    expect(percentOf(cents(1_004), 1_000)).toBe(100); // 100.4 -> 100
  });

  it("handles the bounds", () => {
    expect(percentOf(cents(12_345), 0)).toBe(0);
    expect(percentOf(cents(12_345), 10_000)).toBe(12_345);
  });

  it("does not overflow on very large amounts", () => {
    expect(percentOf(cents(Number.MAX_SAFE_INTEGER), 10_000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects negative amounts and bad rates", () => {
    expect(() => percentOf(cents(-1), 100)).toThrow(RangeError);
    expect(() => percentOf(cents(100), 10_001)).toThrow(RangeError);
    expect(() => percentOf(cents(100), -1)).toThrow(RangeError);
    expect(() => percentOf(cents(100), 12.5)).toThrow(RangeError);
  });
});

describe("splitCommission", () => {
  it("returns a 15% commission on $500.00", () => {
    expect(splitCommission(cents(50_000), 1_500)).toEqual({ commission: 7_500, payout: 42_500 });
  });

  it("always sums back to the total", () => {
    for (let total = 0; total <= 2_000; total += 7) {
      for (const bps of [0, 1, 333, 1_000, 1_250, 1_500, 9_999, 10_000]) {
        const { commission, payout } = splitCommission(cents(total), bps);
        expect(commission + payout).toBe(total);
        expect(commission).toBeGreaterThanOrEqual(0);
        expect(payout).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
