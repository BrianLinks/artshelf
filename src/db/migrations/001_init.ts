import type { Migration } from "../migrate.js";

export const migration001: Migration = {
  id: 1,
  name: "init_users_sessions_audit",
  sql: `
    CREATE TABLE users (
      id            INTEGER PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('client', 'artist', 'moderator', 'admin')),
      created_at    TEXT NOT NULL,
      disabled_at   TEXT
    );

    CREATE TABLE sessions (
      id         INTEGER PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_user_id ON sessions (user_id);
    CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

    CREATE TABLE audit_log (
      id            INTEGER PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
      action        TEXT NOT NULL,
      target_type   TEXT,
      target_id     INTEGER,
      detail        TEXT,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX idx_audit_log_action ON audit_log (action);
  `,
};
