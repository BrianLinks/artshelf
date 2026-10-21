import { describe, expect, it } from "vitest";
import { MAX_QUERY_TOKENS, MAX_TOKEN_LENGTH, toMatchQuery } from "../src/search/query.js";

describe("toMatchQuery", () => {
  it("turns words into quoted prefix terms joined by AND", () => {
    expect(toMatchQuery("Crimson Dragon")).toEqual({ match: '"crimson"* "dragon"*', tokens: ["crimson", "dragon"] });
  });

  it("folds accents and case", () => {
    expect(toMatchQuery("Dragón ÉCOLE").tokens).toEqual(["dragon", "ecole"]);
  });

  it("neutralizes FTS operators and punctuation", () => {
    expect(toMatchQuery('"*()^:- OR NEAR').match).toBe('"or"* "near"*');
    expect(toMatchQuery("dragon AND (fire OR -ice)").tokens).toEqual(["dragon", "and", "fire", "or", "ice"]);
    for (const hostile of ["'; DROP TABLE listings; --", '" OR 1=1 --', "a*b", "\\", "{}[]"]) {
      expect(() => toMatchQuery(hostile)).not.toThrow();
      expect(toMatchQuery(hostile).match ?? "").not.toMatch(/[;()\\]/);
    }
  });

  it("returns no match for input without searchable words", () => {
    for (const empty of ["", "   ", "***", "!!!", "()"]) expect(toMatchQuery(empty)).toEqual({ match: null, tokens: [] });
  });

  it("removes duplicates and caps the number and length of words", () => {
    expect(toMatchQuery("cat cat CAT dog").tokens).toEqual(["cat", "dog"]);
    expect(toMatchQuery("1 2 3 4 5 6 7 8 9 10").tokens).toHaveLength(MAX_QUERY_TOKENS);
    expect(toMatchQuery("x".repeat(200)).tokens[0]).toHaveLength(MAX_TOKEN_LENGTH);
  });

  it("keeps digits and non-latin letters", () => {
    expect(toMatchQuery("forest 2024").tokens).toEqual(["forest", "2024"]);
    expect(toMatchQuery("日本語").tokens).toHaveLength(1);
  });

  it("splits hyphenated words the way the index does", () => {
    expect(toMatchQuery("red-dragon").tokens).toEqual(["red", "dragon"]);
  });
});
