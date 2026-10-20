import { recordAudit } from "../auth/audit.js";
import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";
import { getRecord } from "../listings/repo.js";
import { reinstateListing, removeListing } from "../listings/service.js";
import { notifyAll } from "../notifications/notifications.js";
import { canMoveNotice, type NoticeStatus } from "./machine.js";

interface NoticeRow {
  id: number;
  listing_id: number;
  listing_title: string;
  artist_user_id: number;
  claimant_user_id: number;
  claimant_name: string;
  work_description: string;
  original_url: string | null;
  signature: string;
  status: NoticeStatus;
  resolution_note: string | null;
  counter_statement: string | null;
  counter_signature: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT n.id, n.listing_id, l.title AS listing_title, l.artist_user_id, n.claimant_user_id, u.display_name AS claimant_name,
         n.work_description, n.original_url, n.signature, n.status, n.resolution_note, n.counter_statement,
         n.counter_signature, n.created_at, n.updated_at
  FROM takedown_notices n
  JOIN listings l ON l.id = n.listing_id
  JOIN users u ON u.id = n.claimant_user_id`;

export interface NoticeRecord {
  id: number;
  listingId: number;
  listingTitle: string;
  artistUserId: number;
  claimantUserId: number;
  claimantName: string;
  workDescription: string;
  originalUrl: string | null;
  signature: string;
  status: NoticeStatus;
  resolutionNote: string | null;
  counterStatement: string | null;
  counterSignature: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: NoticeRow): NoticeRecord {
  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: row.listing_title,
    artistUserId: row.artist_user_id,
    claimantUserId: row.claimant_user_id,
    claimantName: row.claimant_name,
    workDescription: row.work_description,
    originalUrl: row.original_url,
    signature: row.signature,
    status: row.status,
    resolutionNote: row.resolution_note,
    counterStatement: row.counter_statement,
    counterSignature: row.counter_signature,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toNoticeView(notice: NoticeRecord) {
  return {
    id: notice.id,
    status: notice.status,
    listing: { id: notice.listingId, title: notice.listingTitle },
    claimant: { userId: notice.claimantUserId, displayName: notice.claimantName },
    artistUserId: notice.artistUserId,
    workDescription: notice.workDescription,
    originalUrl: notice.originalUrl,
    signature: notice.signature,
    resolutionNote: notice.resolutionNote,
    counterStatement: notice.counterStatement,
    counterSignature: notice.counterSignature,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
  };
}
export type NoticeView = ReturnType<typeof toNoticeView>;

export function findNotice(db: Db, id: number): NoticeRecord | undefined {
  const row = db.prepare(`${SELECT} WHERE n.id = ?`).get(id) as NoticeRow | undefined;
  return row ? toRecord(row) : undefined;
}

function requireNotice(db: Db, id: number): NoticeRecord {
  const notice = findNotice(db, id);
  if (!notice) throw new DomainError("not_found", "Notice not found");
  return notice;
}

export function listByClaimant(db: Db, userId: number): NoticeRecord[] {
  return (db.prepare(`${SELECT} WHERE n.claimant_user_id = ? ORDER BY n.id DESC`).all(userId) as NoticeRow[]).map(toRecord);
}

export function listAgainstArtist(db: Db, artistUserId: number): NoticeRecord[] {
  return (db.prepare(`${SELECT} WHERE l.artist_user_id = ? ORDER BY n.id DESC`).all(artistUserId) as NoticeRow[]).map(toRecord);
}

export function listByStatus(db: Db, status: NoticeStatus, limit: number, offset: number): NoticeRecord[] {
  return (db.prepare(`${SELECT} WHERE n.status = ? ORDER BY n.id LIMIT ? OFFSET ?`).all(status, limit, offset) as NoticeRow[]).map(toRecord);
}

function setStatus(db: Db, notice: NoticeRecord, to: NoticeStatus, note: string | undefined, now: Date): void {
  if (!canMoveNotice(notice.status, to)) {
    throw new DomainError("invalid_notice_state", `Cannot move a ${notice.status} notice to ${to}`);
  }
  db.prepare("UPDATE takedown_notices SET status = ?, resolution_note = COALESCE(?, resolution_note), updated_at = ? WHERE id = ?").run(
    to,
    note ?? null,
    now.toISOString(),
    notice.id,
  );
}

export interface NoticeInput {
  listingId: number;
  workDescription: string;
  originalUrl?: string;
  signature: string;
}

/** Anyone signed in may report a listing they believe infringes their work. The sworn statements are validated by the caller. */
export function fileNotice(db: Db, claimantId: number, input: NoticeInput, now: Date = new Date()): NoticeView {
  const id = db.transaction(() => {
    const listing = getRecord(db, input.listingId);
    if (!listing || listing.status === "removed") throw new DomainError("listing_unavailable", "This listing is not available");
    if (listing.artistUserId === claimantId) throw new DomainError("cannot_claim_own_listing", "You cannot file a notice against your own listing");
    const active = db
      .prepare("SELECT id FROM takedown_notices WHERE listing_id = ? AND claimant_user_id = ? AND status IN ('received', 'upheld', 'counter_noticed')")
      .get(input.listingId, claimantId);
    if (active) throw new DomainError("notice_exists", "You already have an open notice against this listing");
    const info = db
      .prepare(
        `INSERT INTO takedown_notices (listing_id, claimant_user_id, work_description, original_url, signature, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.listingId, claimantId, input.workDescription, input.originalUrl ?? null, input.signature, now.toISOString(), now.toISOString());
    const noticeId = Number(info.lastInsertRowid);
    recordAudit(db, { actorUserId: claimantId, action: "takedown.filed", targetType: "takedown", targetId: noticeId });
    return noticeId;
  })();
  return toNoticeView(requireNotice(db, id));
}

/** Staff accept the notice: the listing comes down and both sides are told. */
export function upholdNotice(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): NoticeView {
  db.transaction(() => {
    const notice = requireNotice(db, id);
    setStatus(db, notice, "upheld", note, now);
    if (getRecord(db, notice.listingId)?.status !== "removed") removeListing(db, notice.listingId);
    recordAudit(db, { actorUserId: staffId, action: "takedown.upheld", targetType: "takedown", targetId: id, detail: note ? { note } : undefined });
    notifyAll(db, [notice.artistUserId], {
      kind: "takedown_upheld",
      title: "Your listing was taken down",
      body: `"${notice.listingTitle}" was removed after a copyright notice. You can file a counter-notice if you believe this was a mistake.`,
      refType: "takedown",
      refId: id,
    });
    notifyAll(db, [notice.claimantUserId], {
      kind: "takedown_upheld",
      title: "Your notice was upheld",
      body: `"${notice.listingTitle}" has been removed.`,
      refType: "takedown",
      refId: id,
    });
  })();
  return toNoticeView(requireNotice(db, id));
}

export function rejectNotice(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): NoticeView {
  db.transaction(() => {
    const notice = requireNotice(db, id);
    setStatus(db, notice, "rejected", note, now);
    recordAudit(db, { actorUserId: staffId, action: "takedown.rejected", targetType: "takedown", targetId: id, detail: note ? { note } : undefined });
    notifyAll(db, [notice.claimantUserId], {
      kind: "takedown_rejected",
      title: "Your notice was not upheld",
      body: note ? `Moderators did not remove "${notice.listingTitle}": ${note}` : `Moderators did not remove "${notice.listingTitle}".`,
      refType: "takedown",
      refId: id,
    });
  })();
  return toNoticeView(requireNotice(db, id));
}

/** The artist disputes an upheld removal with a signed statement made in good faith. */
export function fileCounterNotice(
  db: Db,
  artistId: number,
  id: number,
  input: { statement: string; signature: string },
  now: Date = new Date(),
): NoticeView {
  db.transaction(() => {
    const notice = requireNotice(db, id);
    if (notice.artistUserId !== artistId) throw new DomainError("not_found", "Notice not found");
    setStatus(db, notice, "counter_noticed", undefined, now);
    db.prepare("UPDATE takedown_notices SET counter_statement = ?, counter_signature = ? WHERE id = ?").run(input.statement, input.signature, id);
    recordAudit(db, { actorUserId: artistId, action: "takedown.counter_filed", targetType: "takedown", targetId: id });
    notifyAll(db, [notice.claimantUserId], {
      kind: "takedown_counter",
      title: "A counter-notice was filed",
      body: `The artist disputes the removal of "${notice.listingTitle}". Moderators will review it.`,
      refType: "takedown",
      refId: id,
    });
  })();
  return toNoticeView(requireNotice(db, id));
}

/** Staff side with the artist: the listing returns as a draft the artist can republish. */
export function reinstateNotice(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): NoticeView {
  db.transaction(() => {
    const notice = requireNotice(db, id);
    setStatus(db, notice, "reinstated", note, now);
    if (getRecord(db, notice.listingId)?.status === "removed") reinstateListing(db, notice.listingId);
    recordAudit(db, { actorUserId: staffId, action: "takedown.reinstated", targetType: "takedown", targetId: id, detail: note ? { note } : undefined });
    notifyAll(db, [notice.artistUserId, notice.claimantUserId], {
      kind: "takedown_reinstated",
      title: "Listing reinstated",
      body: `"${notice.listingTitle}" was reinstated after review of the counter-notice.`,
      refType: "takedown",
      refId: id,
    });
  })();
  return toNoticeView(requireNotice(db, id));
}

/** Staff keep the removal in place and close the case. */
export function closeNotice(db: Db, staffId: number, id: number, note: string | undefined, now: Date = new Date()): NoticeView {
  db.transaction(() => {
    const notice = requireNotice(db, id);
    setStatus(db, notice, "closed", note, now);
    recordAudit(db, { actorUserId: staffId, action: "takedown.closed", targetType: "takedown", targetId: id, detail: note ? { note } : undefined });
    notifyAll(db, [notice.artistUserId, notice.claimantUserId], {
      kind: "takedown_closed",
      title: "Takedown case closed",
      body: `The removal of "${notice.listingTitle}" stands.`,
      refType: "takedown",
      refId: id,
    });
  })();
  return toNoticeView(requireNotice(db, id));
}
