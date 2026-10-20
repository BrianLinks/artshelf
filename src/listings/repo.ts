import type { Db } from "../db/connection.js";
import { LICENSE_TYPES, licensePrice, type LicenseType } from "../licenses/definitions.js";
import { cents } from "../money.js";
import type { Tier } from "../artists/profiles.js";
import { emptyDistribution, summarizeRatings, type RatingSummary } from "../reviews/rating.js";
import { listingRatings } from "../reviews/stats.js";

export const LISTING_STATUSES = ["draft", "published", "removed"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export interface ListingRecord {
  id: number;
  artistUserId: number;
  assetId: number;
  categorySlug: string;
  categoryName: string;
  title: string;
  description: string;
  basePriceCents: number;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
  artistDisplayName: string;
  artistTier: Tier;
  assetMime: string;
  assetWidth: number | null;
  assetHeight: number | null;
  thumbName: string | null;
  publiclyVisible: boolean;
}

interface ListingRow {
  id: number;
  artist_user_id: number;
  asset_id: number;
  category_slug: string;
  category_name: string;
  title: string;
  description: string;
  base_price_cents: number;
  status: ListingStatus;
  created_at: string;
  updated_at: string;
  display_name: string;
  tier: Tier;
  profile_status: string;
  disabled_at: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  thumb_name: string | null;
}

const SELECT = `
  SELECT l.id, l.artist_user_id, l.asset_id, c.slug AS category_slug, c.name AS category_name,
         l.title, l.description, l.base_price_cents, l.status, l.created_at, l.updated_at,
         u.display_name, p.tier, p.status AS profile_status, u.disabled_at,
         a.mime, a.width, a.height, a.thumb_name
  FROM listings l
  JOIN categories c ON c.id = l.category_id
  JOIN users u ON u.id = l.artist_user_id
  JOIN artist_profiles p ON p.user_id = l.artist_user_id
  JOIN assets a ON a.id = l.asset_id`;

/** A listing is public only while it is published and its artist is approved and active. */
const PUBLIC_CONDITIONS = ["l.status = 'published'", "p.status = 'approved'", "u.disabled_at IS NULL"];

function toRecord(row: ListingRow): ListingRecord {
  return {
    id: row.id,
    artistUserId: row.artist_user_id,
    assetId: row.asset_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    title: row.title,
    description: row.description,
    basePriceCents: row.base_price_cents,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    artistDisplayName: row.display_name,
    artistTier: row.tier,
    assetMime: row.mime,
    assetWidth: row.width,
    assetHeight: row.height,
    thumbName: row.thumb_name,
    publiclyVisible: row.status === "published" && row.profile_status === "approved" && row.disabled_at === null,
  };
}

export function getRecord(db: Db, id: number): ListingRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE l.id = ?`).get(id) as ListingRow | undefined;
  return row ? toRecord(row) : undefined;
}

export function findListingByAsset(db: Db, assetId: number): { id: number; status: ListingStatus } | undefined {
  return db.prepare("SELECT id, status FROM listings WHERE asset_id = ?").get(assetId) as
    | { id: number; status: ListingStatus }
    | undefined;
}

/** The shape sent to clients. Storage names and the asset id stay internal. */
export function toView(record: ListingRecord, licenses: LicenseType[], tags: string[], rating: RatingSummary) {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    publiclyVisible: record.publiclyVisible,
    category: { slug: record.categorySlug, name: record.categoryName },
    basePriceCents: record.basePriceCents,
    licenses: licenses.map((license) => ({
      license,
      priceCents: licensePrice(cents(record.basePriceCents), license),
    })),
    tags,
    rating,
    artist: { userId: record.artistUserId, displayName: record.artistDisplayName, tier: record.artistTier },
    asset: {
      mime: record.assetMime,
      width: record.assetWidth,
      height: record.assetHeight,
      previewUrl: record.thumbName ? `/api/listings/${record.id}/preview` : null,
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
export type ListingView = ReturnType<typeof toView>;

/** Attaches licenses and tags to many listings using two queries, not two per listing. */
export function hydrate(db: Db, records: ListingRecord[]): ListingView[] {
  if (records.length === 0) return [];
  const marks = records.map(() => "?").join(",");
  const ids = records.map((record) => record.id);
  const licenseRows = db
    .prepare(`SELECT listing_id, license_type FROM listing_licenses WHERE listing_id IN (${marks})`)
    .all(...ids) as { listing_id: number; license_type: LicenseType }[];
  const tagRows = db
    .prepare(`SELECT listing_id, tag FROM listing_tags WHERE listing_id IN (${marks}) ORDER BY tag`)
    .all(...ids) as { listing_id: number; tag: string }[];

  const licensesById = new Map<number, LicenseType[]>();
  for (const row of licenseRows) licensesById.set(row.listing_id, [...(licensesById.get(row.listing_id) ?? []), row.license_type]);
  const tagsById = new Map<number, string[]>();
  for (const row of tagRows) tagsById.set(row.listing_id, [...(tagsById.get(row.listing_id) ?? []), row.tag]);

  const ratings = listingRatings(db, ids);
  return records.map((record) => {
    const licenses = (licensesById.get(record.id) ?? []).sort(
      (a, b) => LICENSE_TYPES.indexOf(a) - LICENSE_TYPES.indexOf(b),
    );
    return toView(record, licenses, tagsById.get(record.id) ?? [], ratings.get(record.id) ?? summarizeRatings(emptyDistribution()));
  });
}

export function getView(db: Db, id: number): ListingView | undefined {
  const record = getRecord(db, id);
  return record ? hydrate(db, [record])[0] : undefined;
}

export function listByArtist(db: Db, artistUserId: number): ListingView[] {
  const rows = db.prepare(`${SELECT} WHERE l.artist_user_id = ? ORDER BY l.id DESC`).all(artistUserId) as ListingRow[];
  return hydrate(db, rows.map(toRecord));
}

export const SORTS = ["newest", "price_asc", "price_desc"] as const;
export type Sort = (typeof SORTS)[number];
const ORDER_BY: Record<Sort, string> = {
  newest: "l.id DESC",
  price_asc: "l.base_price_cents ASC, l.id ASC",
  price_desc: "l.base_price_cents DESC, l.id ASC",
};

export interface PublicFilters {
  category?: string;
  license?: LicenseType;
  minPriceCents?: number;
  maxPriceCents?: number;
  tag?: string;
  artist?: number;
  sort: Sort;
  limit: number;
  offset: number;
}

export function listPublic(db: Db, filters: PublicFilters): { listings: ListingView[]; total: number } {
  const conditions = [...PUBLIC_CONDITIONS];
  const params: (string | number)[] = [];
  if (filters.category) {
    conditions.push("c.slug = ?");
    params.push(filters.category);
  }
  if (filters.license) {
    conditions.push("EXISTS (SELECT 1 FROM listing_licenses ll WHERE ll.listing_id = l.id AND ll.license_type = ?)");
    params.push(filters.license);
  }
  if (filters.minPriceCents !== undefined) {
    conditions.push("l.base_price_cents >= ?");
    params.push(filters.minPriceCents);
  }
  if (filters.maxPriceCents !== undefined) {
    conditions.push("l.base_price_cents <= ?");
    params.push(filters.maxPriceCents);
  }
  if (filters.tag) {
    conditions.push("EXISTS (SELECT 1 FROM listing_tags t WHERE t.listing_id = l.id AND t.tag = ?)");
    params.push(filters.tag);
  }
  if (filters.artist !== undefined) {
    conditions.push("l.artist_user_id = ?");
    params.push(filters.artist);
  }
  const where = conditions.join(" AND ");
  const rows = db
    .prepare(`${SELECT} WHERE ${where} ORDER BY ${ORDER_BY[filters.sort]} LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset) as ListingRow[];
  const count = db
    .prepare(
      `SELECT COUNT(*) AS total FROM listings l
       JOIN categories c ON c.id = l.category_id
       JOIN users u ON u.id = l.artist_user_id
       JOIN artist_profiles p ON p.user_id = l.artist_user_id
       WHERE ${where}`,
    )
    .get(...params) as { total: number };
  return { listings: hydrate(db, rows.map(toRecord)), total: count.total };
}
