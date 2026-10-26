import type { Db } from "../db/connection.js";
import type { LicenseType } from "../licenses/definitions.js";

export const ORDER_STATUSES = ["escrow", "disputed", "completed", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderRecord {
  id: number;
  buyerUserId: number;
  artistUserId: number;
  artistDisplayName: string;
  listingId: number;
  listingTitle: string;
  license: LicenseType;
  priceCents: number;
  commissionBps: number;
  commissionCents: number;
  payoutCents: number;
  status: OrderStatus;
  holdUntil: string;
  disputeReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface OrderRow {
  id: number;
  buyer_user_id: number;
  artist_user_id: number;
  artist_display_name: string;
  listing_id: number;
  listing_title: string;
  license_type: LicenseType;
  price_cents: number;
  commission_bps: number;
  commission_cents: number;
  payout_cents: number;
  status: OrderStatus;
  hold_until: string;
  dispute_reason: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const SELECT = `
  SELECT o.id, o.buyer_user_id, o.artist_user_id, u.display_name AS artist_display_name, o.listing_id, o.listing_title,
         o.license_type, o.price_cents, o.commission_bps, o.commission_cents, o.payout_cents, o.status, o.hold_until,
         o.dispute_reason, o.resolution_note, o.created_at, o.updated_at, o.completed_at
  FROM orders o JOIN users u ON u.id = o.artist_user_id`;

function toRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    buyerUserId: row.buyer_user_id,
    artistUserId: row.artist_user_id,
    artistDisplayName: row.artist_display_name,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    license: row.license_type,
    priceCents: row.price_cents,
    commissionBps: row.commission_bps,
    commissionCents: row.commission_cents,
    payoutCents: row.payout_cents,
    status: row.status,
    holdUntil: row.hold_until,
    disputeReason: row.dispute_reason,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function toOrderView(order: OrderRecord) {
  return {
    id: order.id,
    status: order.status,
    listing: { id: order.listingId, title: order.listingTitle },
    license: order.license,
    priceCents: order.priceCents,
    commissionBps: order.commissionBps,
    commissionCents: order.commissionCents,
    payoutCents: order.payoutCents,
    buyer: { userId: order.buyerUserId },
    artist: { userId: order.artistUserId, displayName: order.artistDisplayName },
    holdUntil: order.holdUntil,
    disputeReason: order.disputeReason,
    resolutionNote: order.resolutionNote,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
  };
}
export type OrderView = ReturnType<typeof toOrderView>;

export function findOrder(db: Db, id: number): OrderRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE o.id = ?`).get(id) as OrderRow | undefined;
  return row ? toRecord(row) : undefined;
}

export function listForBuyer(db: Db, buyerUserId: number): OrderRecord[] {
  const rows = db.prepare(`${SELECT} WHERE o.buyer_user_id = ? ORDER BY o.id DESC`).all(buyerUserId) as OrderRow[];
  return rows.map(toRecord);
}

export function listForArtist(db: Db, artistUserId: number): OrderRecord[] {
  const rows = db.prepare(`${SELECT} WHERE o.artist_user_id = ? ORDER BY o.id DESC`).all(artistUserId) as OrderRow[];
  return rows.map(toRecord);
}

export function listOrdersByStatus(db: Db, status: OrderStatus, limit: number, offset: number): OrderRecord[] {
  const rows = db.prepare(`${SELECT} WHERE o.status = ? ORDER BY o.updated_at, o.id LIMIT ? OFFSET ?`).all(status, limit, offset) as OrderRow[];
  return rows.map(toRecord);
}

export function findActivePurchase(db: Db, buyerUserId: number, listingId: number, license: LicenseType): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM orders WHERE buyer_user_id = ? AND listing_id = ? AND license_type = ? AND status <> 'refunded'")
    .get(buyerUserId, listingId, license);
  return row !== undefined;
}

export function dueForRelease(db: Db, nowIso: string): number[] {
  const rows = db.prepare("SELECT id FROM orders WHERE status = 'escrow' AND hold_until <= ? ORDER BY id").all(nowIso) as {
    id: number;
  }[];
  return rows.map((row) => row.id);
}

/** The purchased file, reachable through the order even if the listing is later removed. */
export function purchasedFile(db: Db, orderId: number): { storedName: string; mime: string; originalName: string } | undefined {
  const row = db
    .prepare(
      `SELECT a.stored_name, a.mime, a.original_name
       FROM orders o JOIN listings l ON l.id = o.listing_id JOIN assets a ON a.id = l.asset_id
       WHERE o.id = ?`,
    )
    .get(orderId) as { stored_name: string; mime: string; original_name: string } | undefined;
  return row ? { storedName: row.stored_name, mime: row.mime, originalName: row.original_name } : undefined;
}
