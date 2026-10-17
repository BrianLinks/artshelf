import type { Db } from "../db/connection.js";

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  targetType?: string;
  targetId?: number;
  detail?: Record<string, unknown>;
}

export function recordAudit(db: Db, entry: AuditEntry): void {
  db.prepare(
    "INSERT INTO audit_log (actor_user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    entry.actorUserId,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.detail ? JSON.stringify(entry.detail) : null,
    new Date().toISOString(),
  );
}
