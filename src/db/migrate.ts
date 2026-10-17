import { createHash } from "node:crypto";
import type { Db } from "./connection.js";
import { MIGRATIONS } from "./migrations/index.js";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/**
 * Applies pending migrations in order, each inside its own transaction.
 * Already-applied migrations are verified by checksum so history cannot be edited silently.
 * Returns the ids of the migrations applied by this call.
 */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  for (let i = 0; i < migrations.length; i++) {
    const current = migrations[i];
    const previous = migrations[i - 1];
    if (current && previous && current.id <= previous.id) {
      throw new Error(`Migration ids must be strictly increasing (found ${current.id} after ${previous.id})`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare("SELECT id, checksum FROM schema_migrations").all() as { id: number; checksum: string }[];
  const applied = new Map(rows.map((row) => [row.id, row.checksum]));
  const insert = db.prepare("INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)");
  const ranNow: number[] = [];

  for (const migration of migrations) {
    const sum = checksum(migration.sql);
    const existing = applied.get(migration.id);
    if (existing !== undefined) {
      if (existing !== sum) {
        throw new Error(`Migration ${migration.id} (${migration.name}) checksum mismatch: it was edited after being applied`);
      }
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.id, migration.name, sum, new Date().toISOString());
    })();
    ranNow.push(migration.id);
  }
  return ranNow;
}
