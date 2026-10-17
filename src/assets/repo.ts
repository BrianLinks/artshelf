import type { Db } from "../db/connection.js";

export interface AssetRecord {
  id: number;
  ownerUserId: number;
  categorySlug: string;
  originalName: string;
  storedName: string;
  thumbName: string | null;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdAt: string;
}

interface AssetRow {
  id: number;
  owner_user_id: number;
  category_slug: string;
  original_name: string;
  stored_name: string;
  thumb_name: string | null;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  created_at: string;
}

const SELECT = `
  SELECT a.id, a.owner_user_id, c.slug AS category_slug, a.original_name, a.stored_name, a.thumb_name,
         a.mime, a.size_bytes, a.width, a.height, a.sha256, a.created_at
  FROM assets a JOIN categories c ON c.id = a.category_id`;

function toRecord(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    categorySlug: row.category_slug,
    originalName: row.original_name,
    storedName: row.stored_name,
    thumbName: row.thumb_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

/** The shape sent to clients. Storage file names stay internal. */
export function toPublicAsset(asset: AssetRecord) {
  return {
    id: asset.id,
    ownerUserId: asset.ownerUserId,
    category: asset.categorySlug,
    originalName: asset.originalName,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    hasThumbnail: asset.thumbName !== null,
    createdAt: asset.createdAt,
  };
}

export function findAsset(db: Db, id: number): AssetRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as AssetRow | undefined;
  return row ? toRecord(row) : undefined;
}

export function findAssetByHash(db: Db, ownerUserId: number, sha256: string): AssetRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE a.owner_user_id = ? AND a.sha256 = ?`).get(ownerUserId, sha256) as
    | AssetRow
    | undefined;
  return row ? toRecord(row) : undefined;
}

export function listAssetsByOwner(db: Db, ownerUserId: number): AssetRecord[] {
  const rows = db.prepare(`${SELECT} WHERE a.owner_user_id = ? ORDER BY a.id`).all(ownerUserId) as AssetRow[];
  return rows.map(toRecord);
}

export function storageUsedBy(db: Db, ownerUserId: number): number {
  const row = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS used FROM assets WHERE owner_user_id = ?").get(
    ownerUserId,
  ) as { used: number };
  return row.used;
}

export interface NewAsset {
  ownerUserId: number;
  categoryId: number;
  originalName: string;
  storedName: string;
  thumbName: string | null;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
}

export function insertAsset(db: Db, asset: NewAsset): AssetRecord {
  const info = db
    .prepare(
      `INSERT INTO assets (owner_user_id, category_id, original_name, stored_name, thumb_name, mime, size_bytes, width, height, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      asset.ownerUserId,
      asset.categoryId,
      asset.originalName,
      asset.storedName,
      asset.thumbName,
      asset.mime,
      asset.sizeBytes,
      asset.width,
      asset.height,
      asset.sha256,
      new Date().toISOString(),
    );
  const record = findAsset(db, Number(info.lastInsertRowid));
  if (!record) throw new Error("Asset vanished immediately after insert");
  return record;
}

export function deleteAsset(db: Db, id: number): void {
  db.prepare("DELETE FROM assets WHERE id = ?").run(id);
}
