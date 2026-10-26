import { describe, expect, it } from "vitest";
import { href, hrefWithParams, matchRoute, parseHash } from "../src/lib/router.js";

describe("parseHash", () => {
  it("splits path and query", () => {
    const location = parseHash("#/search?q=cat&page=2");
    expect(location.path).toBe("/search");
    expect(location.query.get("q")).toBe("cat");
    expect(location.query.get("page")).toBe("2");
  });

  it.each([
    ["", "/"],
    ["#", "/"],
    ["#/", "/"],
    ["#wallet", "/wallet"],
    ["#/orders/", "/orders"],
  ])("normalizes %j to %j", (hash, path) => {
    expect(parseHash(hash).path).toBe(path);
  });

  it("keeps encoded characters in the query", () => {
    expect(parseHash("#/search?q=a%20b%26c").query.get("q")).toBe("a b&c");
  });
});

describe("matchRoute", () => {
  it("matches fixed and parameterized routes", () => {
    expect(matchRoute("/")).toEqual({ name: "home", params: {} });
    expect(matchRoute("/search")).toEqual({ name: "search", params: {} });
    expect(matchRoute("/listings/42")).toEqual({ name: "listing", params: { id: "42" } });
    expect(matchRoute("/help/getting-started")).toEqual({ name: "help-article", params: { slug: "getting-started" } });
    expect(matchRoute("/help")).toEqual({ name: "help", params: {} });
  });

  it("prefers fixed request routes over the id route", () => {
    expect(matchRoute("/requests")).toEqual({ name: "requests", params: {} });
    expect(matchRoute("/requests/new")).toEqual({ name: "request-new", params: {} });
    expect(matchRoute("/requests/mine")).toEqual({ name: "requests-mine", params: {} });
    expect(matchRoute("/requests/7")).toEqual({ name: "request", params: { id: "7" } });
    expect(matchRoute("/support/12")).toEqual({ name: "ticket", params: { id: "12" } });
    expect(matchRoute("/artist")).toEqual({ name: "artist", params: {} });
    expect(matchRoute("/requests/7/extra")).toBeNull();
  });

  it("decodes parameters", () => {
    expect(matchRoute("/help/a%20b")?.params.slug).toBe("a b");
  });

  it.each(["/nope", "/listings", "/listings/1/extra", "/wallet/1", "/help/%E0%A4%A", "/login/x"])("does not match %j", (path) => {
    expect(matchRoute(path)).toBeNull();
  });
});

describe("href", () => {
  it("builds links and drops empty values", () => {
    expect(href("/search", { q: "cat", color: "", page: 2, tag: undefined, artist: null })).toBe("#/search?q=cat&page=2");
    expect(href("/wallet")).toBe("#/wallet");
    expect(href("/search", { q: "a b&c" })).toBe("#/search?q=a+b%26c");
  });

  it("round-trips through parseHash", () => {
    const location = parseHash(href("/search", { q: "a b&c", page: 3 }));
    expect(location.path).toBe("/search");
    expect(location.query.get("q")).toBe("a b&c");
    expect(location.query.get("page")).toBe("3");
  });
});

describe("hrefWithParams", () => {
  it("builds a link from URLSearchParams", () => {
    expect(hrefWithParams("/search", new URLSearchParams("q=cat&page=2"))).toBe("#/search?q=cat&page=2");
    expect(hrefWithParams("/search", new URLSearchParams())).toBe("#/search");
  });
});
