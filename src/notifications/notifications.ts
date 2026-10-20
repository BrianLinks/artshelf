import type { Db } from "../db/connection.js";
import { DomainError } from "../errors.js";

/** The outbox: email-style messages stored in the database and read in the app. No mail server is involved. */
export interface NotifyInput {
  kind: string;
  title: string;
  body: string;
  refType?: "order" | "request" | "review" | "ticket" | "takedown" | "listing";
  refId?: number;
}

export function notify(db: Db, userId: number, input: NotifyInput): void {
  db.prepare(
    "INSERT INTO notifications (user_id, kind, title, body, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(userId, input.kind, input.title, input.body, input.refType ?? null, input.refId ?? null, new Date().toISOString());
}

/** Notifies several people at once, skipping missing ids and duplicates. */
export function notifyAll(db: Db, userIds: readonly (number | null | undefined)[], input: NotifyInput): void {
  for (const userId of new Set(userIds)) {
    if (userId !== null && userId !== undefined) notify(db, userId, input);
  }
}

export interface NotificationView {
  id: number;
  kind: string;
  title: string;
  body: string;
  ref: { type: string; id: number } | null;
  read: boolean;
  createdAt: string;
}

interface Row {
  id: number;
  kind: string;
  title: string;
  body: string;
  ref_type: string | null;
  ref_id: number | null;
  read_at: string | null;
  created_at: string;
}

function toView(row: Row): NotificationView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    ref: row.ref_type !== null && row.ref_id !== null ? { type: row.ref_type, id: row.ref_id } : null,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

export function listNotifications(
  db: Db,
  userId: number,
  options: { unreadOnly: boolean; limit: number; offset: number },
): { notifications: NotificationView[]; total: number; unreadCount: number } {
  const where = options.unreadOnly ? "user_id = ? AND read_at IS NULL" : "user_id = ?";
  const rows = db
    .prepare(`SELECT id, kind, title, body, ref_type, ref_id, read_at, created_at FROM notifications WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(userId, options.limit, options.offset) as Row[];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`).get(userId) as { n: number };
  const unread = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as { n: number };
  return { notifications: rows.map(toView), total: total.n, unreadCount: unread.n };
}

/** Marks one notification read. Other people's notifications look like they do not exist. */
export function markRead(db: Db, userId: number, id: number, now: Date = new Date()): void {
  const owned = db.prepare("SELECT id FROM notifications WHERE id = ? AND user_id = ?").get(id, userId);
  if (!owned) throw new DomainError("not_found", "Notification not found");
  db.prepare("UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?").run(now.toISOString(), id);
}

export function markAllRead(db: Db, userId: number, now: Date = new Date()): number {
  return db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now.toISOString(), userId).changes;
}
