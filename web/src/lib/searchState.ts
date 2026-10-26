import { normalizeColor, parseDollarsToCents } from "./format.js";

export const PAGE_SIZE = 20;
export const SORTS = ["relevance", "newest", "price_asc", "price_desc"] as const;
export const LICENSE_TYPES = ["non_commercial", "commercial", "broadcast"] as const;

/** Everything the search page lets you change, as plain strings so it can live in the URL. */
export interface SearchState {
  q: string;
  color: string;
  similarTo: number | null;
  category: string;
  license: string;
  minPrice: string;
  maxPrice: string;
  tag: string;
  artist: number | null;
  sort: string;
  page: number;
}

export const EMPTY_SEARCH: SearchState = {
  q: "",
  color: "",
  similarTo: null,
  category: "",
  license: "",
  minPrice: "",
  maxPrice: "",
  tag: "",
  artist: null,
  sort: "relevance",
  page: 1,
};

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function stateFromQuery(query: URLSearchParams): SearchState {
  const sort = query.get("sort") ?? "";
  const license = query.get("license") ?? "";
  return {
    q: (query.get("q") ?? "").slice(0, 100),
    color: normalizeColor(query.get("color") ?? ""),
    similarTo: positiveInt(query.get("similarTo")),
    category: query.get("category") ?? "",
    license: (LICENSE_TYPES as readonly string[]).includes(license) ? license : "",
    minPrice: query.get("minPrice") ?? "",
    maxPrice: query.get("maxPrice") ?? "",
    tag: query.get("tag") ?? "",
    artist: positiveInt(query.get("artist")),
    sort: (SORTS as readonly string[]).includes(sort) ? sort : "relevance",
    page: positiveInt(query.get("page")) ?? 1,
  };
}

/** Writes only the values that differ from the defaults, so URLs stay short. */
export function stateToQuery(state: Partial<SearchState>): URLSearchParams {
  const merged = { ...EMPTY_SEARCH, ...state };
  const params = new URLSearchParams();
  if (merged.q.trim() !== "") params.set("q", merged.q.trim());
  if (merged.color !== "") params.set("color", merged.color);
  if (merged.similarTo !== null) params.set("similarTo", String(merged.similarTo));
  if (merged.category !== "") params.set("category", merged.category);
  if (merged.license !== "") params.set("license", merged.license);
  if (merged.minPrice !== "") params.set("minPrice", merged.minPrice);
  if (merged.maxPrice !== "") params.set("maxPrice", merged.maxPrice);
  if (merged.tag !== "") params.set("tag", merged.tag);
  if (merged.artist !== null) params.set("artist", String(merged.artist));
  if (merged.sort !== "relevance") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params;
}

/** Converts the page state into parameters for GET /api/search. Dollar fields become cents; invalid ones are dropped. */
export function toApiParams(state: SearchState): Record<string, string | number | undefined> {
  const min = state.minPrice === "" ? null : parseDollarsToCents(state.minPrice);
  const max = state.maxPrice === "" ? null : parseDollarsToCents(state.maxPrice);
  return {
    q: state.q.trim() || undefined,
    color: state.color || undefined,
    similarTo: state.similarTo ?? undefined,
    category: state.category || undefined,
    license: state.license || undefined,
    minPriceCents: min ?? undefined,
    maxPriceCents: max ?? undefined,
    tag: state.tag || undefined,
    artist: state.artist ?? undefined,
    sort: state.sort,
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
  };
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
