import { describe, expect, it } from "vitest";
import { EMPTY_SEARCH, PAGE_SIZE, pageCount, stateFromQuery, stateToQuery, toApiParams } from "../src/lib/searchState.js";

const q = (text: string) => new URLSearchParams(text);

describe("stateFromQuery", () => {
  it("uses defaults for an empty query", () => {
    expect(stateFromQuery(q(""))).toEqual(EMPTY_SEARCH);
  });

  it("reads every field", () => {
    const state = stateFromQuery(q("q=cat&color=%23DC1414&category=sound&license=commercial&minPrice=5&maxPrice=50&tag=sea&artist=3&sort=price_asc&page=2"));
    expect(state).toEqual({
      q: "cat",
      color: "dc1414",
      similarTo: null,
      category: "sound",
      license: "commercial",
      minPrice: "5",
      maxPrice: "50",
      tag: "sea",
      artist: 3,
      sort: "price_asc",
      page: 2,
    });
  });

  it("ignores values the API would reject", () => {
    const state = stateFromQuery(q("color=red&license=exclusive&sort=random&page=0&artist=-1&similarTo=abc"));
    expect(state).toMatchObject({ color: "", license: "", sort: "relevance", page: 1, artist: null, similarTo: null });
    expect(stateFromQuery(q("page=-3")).page).toBe(1);
    expect(stateFromQuery(q("q=" + "x".repeat(300))).q).toHaveLength(100);
  });
});

describe("stateToQuery", () => {
  it("omits defaults", () => {
    expect(stateToQuery(EMPTY_SEARCH).toString()).toBe("");
    expect(stateToQuery({ q: "  cat  ", sort: "relevance", page: 1 }).toString()).toBe("q=cat");
  });

  it("round-trips a full state", () => {
    const state = stateFromQuery(q("q=cat&color=dc1414&category=sound&minPrice=5&sort=newest&page=3&similarTo=9"));
    expect(stateFromQuery(stateToQuery(state))).toEqual(state);
  });
});

describe("toApiParams", () => {
  it("converts dollars to cents and pages to offsets", () => {
    const params = toApiParams({ ...EMPTY_SEARCH, q: " dragon ", minPrice: "5", maxPrice: "$1,200.50", page: 3, color: "dc1414" });
    expect(params).toMatchObject({ q: "dragon", color: "dc1414", minPriceCents: 500, maxPriceCents: 120_050, limit: PAGE_SIZE, offset: 2 * PAGE_SIZE, sort: "relevance" });
  });

  it("drops empty and invalid values", () => {
    const params = toApiParams({ ...EMPTY_SEARCH, minPrice: "abc", maxPrice: "" });
    expect(params.q).toBeUndefined();
    expect(params.minPriceCents).toBeUndefined();
    expect(params.maxPriceCents).toBeUndefined();
    expect(params.category).toBeUndefined();
    expect(params.offset).toBe(0);
  });
});

describe("pageCount", () => {
  it.each([
    [0, 1],
    [1, 1],
    [20, 1],
    [21, 2],
    [100, 5],
  ])("%d results make %d page(s)", (total, pages) => {
    expect(pageCount(total)).toBe(pages);
  });
});
