import { describe, expect, it } from "vitest";
import { emptyDistribution, summarizeList, summarizeRatings } from "../src/reviews/rating.js";

describe("rating summaries", () => {
  it("reports no average when there are no reviews", () => {
    expect(summarizeList([])).toEqual({ count: 0, average: null, averageTenths: null, distribution: emptyDistribution() });
  });

  it("handles a single review", () => {
    expect(summarizeList([5])).toMatchObject({ count: 1, average: 5, averageTenths: 50 });
    expect(summarizeList([1])).toMatchObject({ count: 1, average: 1, averageTenths: 10 });
  });

  it.each([
    [[5, 4], 4.5],
    [[4, 4, 5], 4.3], // 4.333
    [[5, 5, 4], 4.7], // 4.667
    [[1, 1, 2], 1.3], // 1.333
    [[4, 4, 4, 5], 4.3], // 4.25 rounds half up
    [[3, 3, 3, 4], 3.3], // 3.25 rounds half up
    [[2, 2, 2, 2, 3], 2.2], // 2.2 exactly
  ])("averages %j to %d", (ratings, expected) => {
    expect(summarizeList(ratings).average).toBe(expected);
  });

  it("counts each star in the distribution", () => {
    expect(summarizeList([5, 5, 3, 1, 5]).distribution).toEqual({ 1: 1, 2: 0, 3: 1, 4: 0, 5: 3 });
  });

  it("changes when a review is edited", () => {
    const before = summarizeList([5, 4, 3]);
    const after = summarizeList([5, 4, 5]);
    expect(before.average).toBe(4);
    expect(after.average).toBe(4.7);
  });

  it("stays within the range of the ratings and never uses floats for the tenths", () => {
    for (let a = 1; a <= 5; a++) {
      for (let b = 1; b <= 5; b++) {
        for (let c = 1; c <= 5; c++) {
          const summary = summarizeList([a, b, c]);
          expect(Number.isInteger(summary.averageTenths)).toBe(true);
          expect(summary.averageTenths as number).toBeGreaterThanOrEqual(Math.min(a, b, c) * 10);
          expect(summary.averageTenths as number).toBeLessThanOrEqual(Math.max(a, b, c) * 10);
        }
      }
    }
  });

  it("rejects ratings outside 1 to 5", () => {
    for (const bad of [0, 6, 3.5, -1, NaN]) expect(() => summarizeList([bad])).toThrow(RangeError);
  });

  it("summarizes a precomputed distribution", () => {
    expect(summarizeRatings({ 1: 0, 2: 0, 3: 0, 4: 2, 5: 2 })).toMatchObject({ count: 4, average: 4.5 });
  });
});
