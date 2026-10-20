import { recordAudit } from "../auth/audit.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { notify } from "../notifications/notifications.js";
import { findOrder } from "../orders/repo.js";
import { findRequest } from "../requests/repo.js";
import { canMoveReview, type ReviewStatus } from "./machine.js";
import type { RatingSummary } from "./rating.js";
import { artistRating } from "./stats.js";

export const FLAG_REASONS = ["spam", "abusive", "off_topic", "other"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

interface ReviewRow {
  id: number;
  reviewer_user_id: number;
  reviewer_name: string;
  artist_user_id: number;
  order_id: number | null;
  request_id: number | null;
  listing_id: number | null;
  rating: number;
  comment: string;
  status: ReviewStatus;
  moderation_note: string | null;
  created_at: string;
  edited_at: string | null;
  open_flags: number;
}

const SELECT = `
  SELECT r.id, r.reviewer_user_id, u.display_name AS reviewer_name, r.artist_user_id, r.order_id, r.request_id,
         o.listing_id AS listing_id, r.rating, r.comment, r.status, r.moderation_note, r.created_at, r.edited_at,
         (SELECT COUNT(*) FROM review_flags f WHERE f.review_id = r.id AND f.resolved_at IS NULL) AS open_flags
  FROM reviews r
  JOIN users u ON u.id = r.reviewer_user_id
  LEFT JOIN orders o ON o.id = r.order_id`;

/** What anyone may see. Status, flags and moderator notes stay out of it. */
function toPublic(row: ReviewRow) {
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    source: row.order_id !== null ? { type: "order" as const, id: row.order_id } : { type: "request" as const, id: row.request_id as number },
    listingId: row.listing_id,
    reviewer: { userId: row.reviewer_user_id, displayName: row.reviewer_name },
    artistUserId: row.artist_user_id,
    edited: row.edited_at !== null,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/** For the reviewer and for staff: adds moderation state. */
function toPrivate(row: ReviewRow) {
  return { ...toPublic(row), status: row.status, moderationNote: row.moderation_note, openFlags: row.open_flags };
}

export type PublicReview = ReturnType<typeof toPublic>;
export type PrivateReview = ReturnType<typeof toPrivate>;

function getRow(db: Db, id: number): ReviewRow {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as ReviewRow | undefined;
  if (!row) throw new DomainError("not_found", "Review not found");
  return row;
}

export interface ReviewInput {
  orderId?: number;
  requestId?: number;
  rating: number;
  comment: string;
}

/** Only the buyer of a completed order, or the client of a completed commission, may review, once. */
export function createReview(db: Db, reviewerId: number, input: ReviewInput, now: Date = new Date()): PrivateReview {
  const id = db.transaction(() => {
    let artistId: number;
    let title: string;
    if (input.orderId !== undefined) {
      const order = findOrder(db, input.orderId);
      if (!order || order.buyerUserId !== reviewerId) throw new DomainError("not_found", "Order not found");
      if (order.status !== "completed") throw new DomainError("not_reviewable", "You can review an order once it is completed");
      artistId = order.artistUserId;
      title = order.listingTitle;
    } else if (input.requestId !== undefined) {
      const request = findRequest(db, input.requestId);
      if (!request || request.clientUserId !== reviewerId) throw new DomainError("not_found", "Request not found");
      if (request.status !== "completed" || request.artistUserId === null) {
        throw new DomainError("not_reviewable", "You can review a commission once it is completed");
      }
      artistId = request.artistUserId;
      title = request.title;
    } else {
      throw new DomainError("not_found", "Nothing to review");
    }

    const existing = db
      .prepare("SELECT id FROM reviews WHERE (order_id IS ? AND order_id IS NOT NULL) OR (request_id IS ? AND request_id IS NOT NULL)")
      .get(input.orderId ?? null, input.requestId ?? null);
    if (existing) throw new DomainError("already_reviewed", "You already reviewed this");

    const timestamp = now.toISOString();
    const info = db
      .prepare(
        `INSERT INTO reviews (reviewer_user_id, artist_user_id, order_id, request_id, rating, comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(reviewerId, artistId, input.orderId ?? null, input.requestId ?? null, input.rating, input.comment, timestamp, timestamp);
    const reviewId = Number(info.lastInsertRowid);
    notify(db, artistId, {
      kind: "review_received",
      title: "New review",
      body: `${title} received a ${input.rating}-star review.`,
      refType: "review",
      refId: reviewId,
    });
    return reviewId;
  })();
  return toPrivate(getRow(db, id));
}

/** The reviewer may change their rating and comment. The review is marked as edited. */
export function updateReview(db: Db, reviewerId: number, id: number, input: { rating: number; comment: string }, now: Date = new Date()): PrivateReview {
  db.transaction(() => {
    const row = getRow(db, id);
    if (row.reviewer_user_id !== reviewerId) throw new DomainError("not_found", "Review not found");
    if (row.status === "hidden") throw new DomainError("invalid_review_state", "A hidden review cannot be edited");
    db.prepare("UPDATE reviews SET rating = ?, comment = ?, edited_at = ?, updated_at = ? WHERE id = ?").run(
      input.rating,
      input.comment,
      now.toISOString(),
      now.toISOString(),
      id,
    );
  })();
  return toPrivate(getRow(db, id));
}

export function getReviewFor(db: Db, viewerId: number, viewerIsStaff: boolean, id: number): PublicReview | PrivateReview {
  const row = getRow(db, id);
  if (viewerIsStaff || row.reviewer_user_id === viewerId) return toPrivate(row);
  if (row.status === "hidden") throw new DomainError("not_found", "Review not found");
  return toPublic(row);
}

export function listPublicReviews(
  db: Db,
  filter: { artist?: number; listing?: number; limit: number; offset: number },
): { reviews: PublicReview[]; total: number; rating: RatingSummary | null } {
  const conditions = ["r.status <> 'hidden'"];
  const params: number[] = [];
  if (filter.artist !== undefined) {
    conditions.push("r.artist_user_id = ?");
    params.push(filter.artist);
  }
  if (filter.listing !== undefined) {
    conditions.push("o.listing_id = ?");
    params.push(filter.listing);
  }
  const where = conditions.join(" AND ");
  const rows = db.prepare(`${SELECT} WHERE ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...params, filter.limit, filter.offset) as ReviewRow[];
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM reviews r LEFT JOIN orders o ON o.id = r.order_id WHERE ${where}`)
    .get(...params) as { n: number };
  return {
    reviews: rows.map(toPublic),
    total: count.n,
    rating: filter.artist !== undefined && filter.listing === undefined ? artistRating(db, filter.artist) : null,
  };
}

/** Completed purchases and commissions the user has not reviewed yet. */
export function listReviewable(db: Db, userId: number) {
  const orders = db
    .prepare(
      `SELECT o.id, o.listing_title AS title, o.completed_at FROM orders o
       WHERE o.buyer_user_id = ? AND o.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id)
       ORDER BY o.id DESC`,
    )
    .all(userId) as { id: number; title: string; completed_at: string }[];
  const requests = db
    .prepare(
      `SELECT q.id, q.title, q.completed_at FROM requests q
       WHERE q.client_user_id = ? AND q.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.request_id = q.id)
       ORDER BY q.id DESC`,
    )
    .all(userId) as { id: number; title: string; completed_at: string }[];
  return {
    orders: orders.map((o) => ({ orderId: o.id, title: o.title, completedAt: o.completed_at })),
    requests: requests.map((q) => ({ requestId: q.id, title: q.title, completedAt: q.completed_at })),
  };
}

// ---- abuse reports and moderation ----

export function flagReview(db: Db, reporterId: number, id: number, input: { reason: FlagReason; note: string }, now: Date = new Date()): void {
  db.transaction(() => {
    const row = getRow(db, id);
    if (row.status === "hidden") throw new DomainError("not_found", "Review not found");
    if (row.reviewer_user_id === reporterId) throw new DomainError("cannot_flag_own_review", "You cannot report your own review");
    const dup = db.prepare("SELECT id FROM review_flags WHERE review_id = ? AND reporter_user_id = ?").get(id, reporterId);
    if (dup) throw new DomainError("already_flagged", "You already reported this review");
    db.prepare("INSERT INTO review_flags (review_id, reporter_user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      reporterId,
      input.reason,
      input.note,
      now.toISOString(),
    );
    if (row.status === "visible") db.prepare("UPDATE reviews SET status = 'flagged', updated_at = ? WHERE id = ?").run(now.toISOString(), id);
  })();
}

export function listForModeration(db: Db, status: "flagged" | "hidden", limit: number, offset: number) {
  const rows = db.prepare(`${SELECT} WHERE r.status = ? ORDER BY r.updated_at, r.id LIMIT ? OFFSET ?`).all(status, limit, offset) as ReviewRow[];
  return rows.map((row) => {
    const flags = db
      .prepare("SELECT reporter_user_id, reason, note, created_at, resolved_at FROM review_flags WHERE review_id = ? ORDER BY id")
      .all(row.id) as { reporter_user_id: number; reason: string; note: string; created_at: string; resolved_at: string | null }[];
    return {
      ...toPrivate(row),
      flags: flags.map((flag) => ({
        reporterUserId: flag.reporter_user_id,
        reason: flag.reason,
        note: flag.note,
        createdAt: flag.created_at,
        resolved: flag.resolved_at !== null,
      })),
    };
  });
}

function moveReview(db: Db, staffId: number, id: number, to: ReviewStatus, action: string, note: string | undefined, now: Date): void {
  const row = getRow(db, id);
  if (!canMoveReview(row.status, to)) throw new DomainError("invalid_review_state", `Cannot move a ${row.status} review to ${to}`);
  db.prepare("UPDATE reviews SET status = ?, moderation_note = ?, updated_at = ? WHERE id = ?").run(to, note ?? null, now.toISOString(), id);
  db.prepare("UPDATE review_flags SET resolved_at = ? WHERE review_id = ? AND resolved_at IS NULL").run(now.toISOString(), id);
  recordAudit(db, { actorUserId: staffId, action, targetType: "review", targetId: id, detail: note ? { note } : undefined });
}

export function hideReview(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): PrivateReview {
  db.transaction(() => {
    const row = getRow(db, id);
    moveReview(db, staffId, id, "hidden", "review.hidden", note, now);
    notify(db, row.reviewer_user_id, {
      kind: "review_hidden",
      title: "Your review was hidden",
      body: note ? `A moderator hid your review: ${note}` : "A moderator hid your review after reports.",
      refType: "review",
      refId: id,
    });
  })();
  return toPrivate(getRow(db, id));
}

/** Staff decide the reports were unfounded: the review is visible again and the reports are closed. */
export function dismissFlags(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): PrivateReview {
  db.transaction(() => {
    const row = getRow(db, id);
    if (row.status !== "flagged") throw new DomainError("invalid_review_state", `Cannot dismiss reports on a ${row.status} review`);
    moveReview(db, staffId, id, "visible", "review.flags_dismissed", note, now);
  })();
  return toPrivate(getRow(db, id));
}

export function restoreReview(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): PrivateReview {
  db.transaction(() => {
    const row = getRow(db, id);
    if (row.status !== "hidden") throw new DomainError("invalid_review_state", `Cannot restore a ${row.status} review`);
    moveReview(db, staffId, id, "visible", "review.restored", note, now);
  })();
  return toPrivate(getRow(db, id));
}
