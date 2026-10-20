export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];
export type Distribution = Record<Rating, number>;

export interface RatingSummary {
  count: number;
  /** Mean rating to one decimal place, or null when there are no reviews. */
  average: number | null;
  /** The same mean in tenths (43 means 4.3), computed with integer arithmetic only. */
  averageTenths: number | null;
  distribution: Distribution;
}

export function emptyDistribution(): Distribution {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/** Summarizes counts per star. The mean is rounded half up to one decimal using integers, so there is no float drift. */
export function summarizeRatings(distribution: Distribution): RatingSummary {
  let count = 0;
  let total = 0;
  for (const rating of RATINGS) {
    count += distribution[rating];
    total += rating * distribution[rating];
  }
  if (count === 0) return { count: 0, average: null, averageTenths: null, distribution };
  const averageTenths = Math.floor((20 * total + count) / (2 * count));
  return { count, average: averageTenths / 10, averageTenths, distribution };
}

export function summarizeList(ratings: readonly number[]): RatingSummary {
  const distribution = emptyDistribution();
  for (const rating of ratings) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new RangeError(`Invalid rating: ${rating}`);
    distribution[rating as Rating] += 1;
  }
  return summarizeRatings(distribution);
}
