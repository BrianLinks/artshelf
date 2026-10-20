import { getProfile } from "../artists/profiles.js";
import { findAsset } from "../assets/repo.js";
import { findCategoryBySlug } from "../catalog/categories.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import type { LicenseType } from "../licenses/definitions.js";
import { getRecord, getView, type ListingRecord, type ListingStatus, type ListingView } from "./repo.js";

export interface ListingInput {
  title: string;
  description: string;
  basePriceCents: number;
  licenses: LicenseType[];
  tags: string[];
}

const TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ["published", "removed"],
  published: ["draft", "removed"],
  removed: ["draft"], // only through a successful counter-notice, see reinstateListing
};

function view(db: Db, id: number): ListingView {
  const result = getView(db, id);
  if (!result) throw new DomainError("not_found", "Listing not found");
  return result;
}

/** Owner-only access. Anyone else gets not_found so private drafts are not revealed. */
function ownedRecord(db: Db, artistId: number, id: number): ListingRecord {
  const record = getRecord(db, id);
  if (!record || record.artistUserId !== artistId) throw new DomainError("not_found", "Listing not found");
  return record;
}

function replaceChildren(db: Db, id: number, input: ListingInput): void {
  db.prepare("DELETE FROM listing_licenses WHERE listing_id = ?").run(id);
  db.prepare("DELETE FROM listing_tags WHERE listing_id = ?").run(id);
  const addLicense = db.prepare("INSERT INTO listing_licenses (listing_id, license_type) VALUES (?, ?)");
  for (const license of input.licenses) addLicense.run(id, license);
  const addTag = db.prepare("INSERT INTO listing_tags (listing_id, tag) VALUES (?, ?)");
  for (const tag of input.tags) addTag.run(id, tag);
}

export function createListing(db: Db, artistId: number, input: ListingInput & { assetId: number }): ListingView {
  if (!getProfile(db, artistId)) throw new DomainError("profile_required", "Create your artist profile first");
  const asset = findAsset(db, input.assetId);
  if (!asset || asset.ownerUserId !== artistId) throw new DomainError("invalid_asset", "Asset not found or not yours");
  const category = findCategoryBySlug(db, asset.categorySlug);
  if (!category) throw new DomainError("invalid_asset", "Asset has an unknown category");

  const id = db.transaction(() => {
    const now = new Date().toISOString();
    let listingId: number;
    try {
      const info = db
        .prepare(
          `INSERT INTO listings (artist_user_id, asset_id, category_id, title, description, base_price_cents, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(artistId, asset.id, category.id, input.title, input.description, input.basePriceCents, now, now);
      listingId = Number(info.lastInsertRowid);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw new DomainError("asset_already_listed", "This asset already has a listing");
      }
      throw error;
    }
    replaceChildren(db, listingId, input);
    return listingId;
  })();
  return view(db, id);
}

export function updateListing(db: Db, artistId: number, id: number, input: ListingInput): ListingView {
  const record = ownedRecord(db, artistId, id);
  if (record.status === "removed") throw new DomainError("invalid_listing_state", "Removed listings cannot be edited");
  db.transaction(() => {
    db.prepare("UPDATE listings SET title = ?, description = ?, base_price_cents = ?, updated_at = ? WHERE id = ?").run(
      input.title,
      input.description,
      input.basePriceCents,
      new Date().toISOString(),
      id,
    );
    replaceChildren(db, id, input);
  })();
  return view(db, id);
}

function changeStatus(db: Db, record: ListingRecord, to: ListingStatus): ListingView {
  if (!TRANSITIONS[record.status].includes(to)) {
    throw new DomainError("invalid_listing_state", `Cannot move a ${record.status} listing to ${to}`);
  }
  db.prepare("UPDATE listings SET status = ?, updated_at = ? WHERE id = ?").run(to, new Date().toISOString(), record.id);
  return view(db, record.id);
}

export function publishListing(db: Db, artistId: number, id: number): ListingView {
  const record = ownedRecord(db, artistId, id);
  if (getProfile(db, artistId)?.status !== "approved") {
    throw new DomainError("profile_not_approved", "Your artist profile must be approved before you can publish");
  }
  return changeStatus(db, record, "published");
}

export function unpublishListing(db: Db, artistId: number, id: number): ListingView {
  const record = ownedRecord(db, artistId, id);
  if (record.status !== "published") throw new DomainError("invalid_listing_state", `Cannot unpublish a ${record.status} listing`);
  return changeStatus(db, record, "draft");
}

/** Moderator takedown. Terminal: the artist cannot republish a removed listing. */
export function removeListing(db: Db, id: number): ListingView {
  const record = getRecord(db, id);
  if (!record) throw new DomainError("not_found", "Listing not found");
  return changeStatus(db, record, "removed");
}

/** Brings a removed listing back as a draft. Only a resolved takedown dispute should call this. */
export function reinstateListing(db: Db, id: number): ListingView {
  const record = getRecord(db, id);
  if (!record) throw new DomainError("not_found", "Listing not found");
  if (record.status !== "removed") throw new DomainError("invalid_listing_state", "Only removed listings can be reinstated");
  return changeStatus(db, record, "draft");
}
