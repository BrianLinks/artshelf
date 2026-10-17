import type { Db } from "../db/connection.js";
import { findCategoryBySlug } from "../catalog/categories.js";
import { DomainError } from "../errors.js";

export const TIERS = ["standard", "premium"] as const;
export type Tier = (typeof TIERS)[number];

export const PROFILE_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export interface ArtistProfile {
  userId: number;
  displayName: string;
  bio: string;
  specialty: string;
  tier: Tier;
  status: ProfileStatus;
  createdAt: string;
  updatedAt: string;
}

interface ProfileRow {
  user_id: number;
  display_name: string;
  bio: string;
  specialty: string;
  tier: Tier;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT p.user_id, u.display_name, p.bio, c.slug AS specialty, p.tier, p.status, p.created_at, p.updated_at
  FROM artist_profiles p
  JOIN users u ON u.id = p.user_id
  JOIN categories c ON c.id = p.category_id`;

function toProfile(row: ProfileRow): ArtistProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    specialty: row.specialty,
    tier: row.tier,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProfile(db: Db, userId: number): ArtistProfile | undefined {
  const row = db.prepare(`${SELECT} WHERE p.user_id = ?`).get(userId) as ProfileRow | undefined;
  return row ? toProfile(row) : undefined;
}

function requireProfile(db: Db, userId: number): ArtistProfile {
  const profile = getProfile(db, userId);
  if (!profile) throw new DomainError("not_found", "Artist profile not found");
  return profile;
}

/** Creates or edits a profile. Editing a rejected profile resubmits it for review. */
export function upsertProfile(db: Db, userId: number, input: { bio: string; specialty: string }): ArtistProfile {
  const category = findCategoryBySlug(db, input.specialty);
  if (!category) throw new DomainError("unknown_category", "Unknown specialty category");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO artist_profiles (user_id, bio, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       bio = excluded.bio,
       category_id = excluded.category_id,
       updated_at = excluded.updated_at,
       status = CASE WHEN artist_profiles.status = 'rejected' THEN 'pending' ELSE artist_profiles.status END`,
  ).run(userId, input.bio, category.id, now, now);
  return requireProfile(db, userId);
}

const ALLOWED_TRANSITIONS: Record<ProfileStatus, readonly ProfileStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["rejected"],
  rejected: ["approved"],
};

export function transitionStatus(db: Db, userId: number, to: ProfileStatus): ArtistProfile {
  const profile = requireProfile(db, userId);
  if (!ALLOWED_TRANSITIONS[profile.status].includes(to)) {
    throw new DomainError("invalid_transition", `Cannot move a ${profile.status} profile to ${to}`);
  }
  db.prepare("UPDATE artist_profiles SET status = ?, updated_at = ? WHERE user_id = ?").run(
    to,
    new Date().toISOString(),
    userId,
  );
  return requireProfile(db, userId);
}

export function setTier(db: Db, userId: number, tier: Tier): ArtistProfile {
  requireProfile(db, userId);
  db.prepare("UPDATE artist_profiles SET tier = ?, updated_at = ? WHERE user_id = ?").run(
    tier,
    new Date().toISOString(),
    userId,
  );
  return requireProfile(db, userId);
}

export interface ListOptions {
  category?: string;
  tier?: Tier;
  limit: number;
  offset: number;
}

/** Public listing: approved profiles of active users, premium first. */
export function listApproved(db: Db, options: ListOptions): ArtistProfile[] {
  const conditions = ["p.status = 'approved'", "u.disabled_at IS NULL"];
  const params: (string | number)[] = [];
  if (options.category) {
    conditions.push("c.slug = ?");
    params.push(options.category);
  }
  if (options.tier) {
    conditions.push("p.tier = ?");
    params.push(options.tier);
  }
  const rows = db
    .prepare(
      `${SELECT} WHERE ${conditions.join(" AND ")}
       ORDER BY CASE p.tier WHEN 'premium' THEN 0 ELSE 1 END, p.user_id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as ProfileRow[];
  return rows.map(toProfile);
}

export function listByStatus(db: Db, status: ProfileStatus, limit: number, offset: number): ArtistProfile[] {
  const rows = db
    .prepare(`${SELECT} WHERE p.status = ? ORDER BY p.updated_at, p.user_id LIMIT ? OFFSET ?`)
    .all(status, limit, offset) as ProfileRow[];
  return rows.map(toProfile);
}
