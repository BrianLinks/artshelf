import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { buildPublicFilter, getRecord, getRecordsInOrder, hydrate, type ListingView, type PublicFilterInput } from "../listings/repo.js";
import { similarityScore, solidPalette, type PaletteColor, type RGB } from "./color.js";
import { loadPalettes } from "./palettes.js";
import { toMatchQuery } from "./query.js";

export const SEARCH_SORTS = ["relevance", "newest", "price_asc", "price_desc"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Color ranking looks at this many of the newest matching listings. Plenty for a single-node catalog. */
export const MAX_COLOR_CANDIDATES = 2_000;

export interface SearchParams extends PublicFilterInput {
  q?: string;
  color?: RGB;
  similarTo?: number;
  sort: SearchSort;
  limit: number;
  offset: number;
}

export type SearchHit = ListingView & { colorScore: number | null };
export interface SearchResult {
  listings: SearchHit[];
  total: number;
  tokens: string[];
}

const BM25 = "bm25(listing_search, 10.0, 1.0, 5.0, 2.0, 3.0)"; // title, description, tags, artist, category
const ORDER: Record<Exclude<SearchSort, "relevance">, string> = {
  newest: "l.id DESC",
  price_asc: "l.base_price_cents ASC, l.id ASC",
  price_desc: "l.base_price_cents DESC, l.id ASC",
};
const JOINS = `
  JOIN categories c ON c.id = l.category_id
  JOIN users u ON u.id = l.artist_user_id
  JOIN artist_profiles p ON p.user_id = l.artist_user_id`;

/**
 * Public search over listings: full-text (SQLite FTS5, ranked by BM25 with title and tag weight), color (a wanted
 * color, or the palette of another listing), and the same filters as browsing. Only publicly visible listings can match.
 * With a color, results are ranked by color similarity; sorting by price or date reorders those matches.
 */
export function searchListings(db: Db, params: SearchParams): SearchResult {
  const text = params.q === undefined ? { match: null, tokens: [] as string[] } : toMatchQuery(params.q);
  if (params.q !== undefined && text.match === null) return { listings: [], total: 0, tokens: [] };

  let target: PaletteColor[] | undefined;
  let excludeId: number | undefined;
  if (params.similarTo !== undefined) {
    const source = getRecord(db, params.similarTo);
    if (!source || !source.publiclyVisible) throw new DomainError("not_found", "Listing not found");
    const palette = loadPalettes(db, [source.assetId]).get(source.assetId);
    if (!palette || palette.length === 0) throw new DomainError("no_palette", "That listing has no color information");
    target = palette;
    excludeId = source.id;
  } else if (params.color) {
    target = solidPalette(params.color);
  }

  const filter = buildPublicFilter(params);
  const conditions = [filter.where];
  const bind: (string | number)[] = [...filter.params];
  if (text.match !== null) {
    conditions.push("listing_search MATCH ?");
    bind.push(text.match);
  }
  if (excludeId !== undefined) {
    conditions.push("l.id <> ?");
    bind.push(excludeId);
  }
  const where = conditions.join(" AND ");
  const from = text.match !== null ? "listing_search JOIN listings l ON l.id = listing_search.rowid" : "listings l";
  const rankColumn = text.match !== null ? `, ${BM25} AS rank` : ", 0 AS rank";

  if (target) return rankByColor(db, { from, where, bind, rankColumn }, target, params, text.tokens);

  const order = params.sort === "relevance" ? (text.match !== null ? `${BM25}, l.id DESC` : "l.id DESC") : ORDER[params.sort];
  const ids = (
    db.prepare(`SELECT l.id AS id FROM ${from} ${JOINS} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...bind, params.limit, params.offset) as {
      id: number;
    }[]
  ).map((row) => row.id);
  const count = db.prepare(`SELECT COUNT(*) AS total FROM ${from} ${JOINS} WHERE ${where}`).get(...bind) as { total: number };
  const listings = hydrate(db, getRecordsInOrder(db, ids)).map((view) => ({ ...view, colorScore: null }));
  return { listings, total: count.total, tokens: text.tokens };
}

function rankByColor(
  db: Db,
  query: { from: string; where: string; bind: (string | number)[]; rankColumn: string },
  target: PaletteColor[],
  params: SearchParams,
  tokens: string[],
): SearchResult {
  const rows = db
    .prepare(
      `SELECT l.id AS id, l.asset_id AS asset_id, l.base_price_cents AS price${query.rankColumn}
       FROM ${query.from} ${JOINS} WHERE ${query.where} ORDER BY l.id DESC LIMIT ${MAX_COLOR_CANDIDATES}`,
    )
    .all(...query.bind) as { id: number; asset_id: number; price: number; rank: number }[];
  const palettes = loadPalettes(db, rows.map((row) => row.asset_id));

  const scored = rows
    .map((row) => {
      const palette = palettes.get(row.asset_id);
      return { id: row.id, price: row.price, rank: row.rank, score: palette ? similarityScore(target, palette) : 0 };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => {
    switch (params.sort) {
      case "newest":
        return b.id - a.id;
      case "price_asc":
        return a.price - b.price || a.id - b.id;
      case "price_desc":
        return b.price - a.price || a.id - b.id;
      default:
        return b.score - a.score || a.rank - b.rank || b.id - a.id;
    }
  });

  const page = scored.slice(params.offset, params.offset + params.limit);
  const scores = new Map(page.map((entry) => [entry.id, entry.score]));
  const listings = hydrate(db, getRecordsInOrder(db, page.map((entry) => entry.id))).map((view) => ({
    ...view,
    colorScore: scores.get(view.id) ?? null,
  }));
  return { listings, total: scored.length, tokens };
}
