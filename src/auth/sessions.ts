import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/connection.js";
import { toUser, type User, type UserRow } from "./users.js";

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash of a session token is stored, so a leaked database cannot be replayed as cookies. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(
  db: Db,
  userId: number,
  ttlHours: number,
  now: Date = new Date(),
): { token: string; expiresAt: string } {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    now.toISOString(),
    expiresAt,
  );
  return { token, expiresAt };
}

/** Returns the user for a valid, unexpired session whose account is not disabled. */
export function resolveSession(db: Db, token: string, now: Date = new Date()): User | undefined {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.display_name, u.role, u.created_at, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
    )
    .get(hashToken(token), now.toISOString()) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteUserSessions(db: Db, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteExpiredSessions(db: Db, now: Date = new Date()): number {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString()).changes;
}
