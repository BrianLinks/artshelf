import type { Db } from "../db/connection.js";
import type { Role } from "./roles.js";

export interface User {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
  disabledAt: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: Role;
  created_at: string;
  disabled_at: string | null;
}

export const USER_COLUMNS = "id, email, display_name, role, created_at, disabled_at";

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export class EmailTakenError extends Error {
  constructor() {
    super("Email is already registered");
  }
}

export function findById(db: Db, id: number): User | undefined {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function createUser(
  db: Db,
  input: { email: string; passwordHash: string; displayName: string; role: Role },
): User {
  let id: number;
  try {
    const info = db
      .prepare("INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.email, input.passwordHash, input.displayName, input.role, new Date().toISOString());
    id = Number(info.lastInsertRowid);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new EmailTakenError();
    }
    throw error;
  }
  const user = findById(db, id);
  if (!user) throw new Error("User vanished immediately after insert");
  return user;
}

export function findCredentialsByEmail(db: Db, email: string): { user: User; passwordHash: string } | undefined {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .get(email) as (UserRow & { password_hash: string }) | undefined;
  return row ? { user: toUser(row), passwordHash: row.password_hash } : undefined;
}

export function listUsers(db: Db): User[] {
  const rows = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`).all() as UserRow[];
  return rows.map(toUser);
}

export function setRole(db: Db, id: number, role: Role): User | undefined {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  return findById(db, id);
}

export function setDisabled(db: Db, id: number, disabled: boolean): User | undefined {
  db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(disabled ? new Date().toISOString() : null, id);
  return findById(db, id);
}
