import type { Db } from "../db/connection.js";
import { emptyDistribution, summarizeRatings, type Rating, type RatingSummary } from "./rating.js";

/** Hidden reviews never count. Flagged reviews still count until a moderator decides. */
export function artistRating(db: Db, artistUserId: number): RatingSummary {
  const rows = db
    .prepare("SELECT rating, COUNT(*) AS n FROM reviews WHERE artist_user_id = ? AND status <> 'hidden' GROUP BY rating")
    .all(artistUserId) as { rating: Rating; n: number }[];
  const distribution = emptyDistribution();
  for (const row of rows) distribution[row.rating] = row.n;
  return summarizeRatings(distribution);
}

/** Ratings for many listings with one query. Listings without reviews get an empty summary. */
export function listingRatings(db: Db, listingIds: readonly number[]): Map<number, RatingSummary> {
  const result = new Map<number, RatingSummary>();
  if (listingIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT o.listing_id AS listing_id, r.rating AS rating, COUNT(*) AS n
       FROM reviews r JOIN orders o ON o.id = r.order_id
       WHERE o.listing_id IN (${listingIds.map(() => "?").join(",")}) AND r.status <> 'hidden'
       GROUP BY o.listing_id, r.rating`,
    )
    .all(...listingIds) as { listing_id: number; rating: Rating; n: number }[];
  const distributions = new Map<number, ReturnType<typeof emptyDistribution>>();
  for (const row of rows) {
    const distribution = distributions.get(row.listing_id) ?? emptyDistribution();
    distribution[row.rating] = row.n;
    distributions.set(row.listing_id, distribution);
  }
  for (const id of listingIds) result.set(id, summarizeRatings(distributions.get(id) ?? emptyDistribution()));
  return result;
}
