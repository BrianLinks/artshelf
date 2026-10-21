import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { migrate, type Migration } from "../src/db/migrate.js";
import { MIGRATIONS } from "../src/db/migrations/index.js";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("migrate", () => {
  it("creates the schema and records applied migrations", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db)).toEqual(MIGRATIONS.map((migration) => migration.id));
    expect(tableNames(db)).toEqual(expect.arrayContaining(["users", "sessions", "audit_log", "schema_migrations", "categories", "artist_profiles", "assets", "listings", "listing_licenses", "listing_tags", "requests", "reviews", "tickets", "notifications", "asset_colors", "listing_search"]));
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(migrate(db)).toEqual([]);
  });

  it("applies only new migrations on a later run", () => {
    const db = openDatabase(":memory:");
    const first: Migration = { id: 1, name: "a", sql: "CREATE TABLE a (x INTEGER)" };
    const second: Migration = { id: 2, name: "b", sql: "CREATE TABLE b (x INTEGER)" };
    expect(migrate(db, [first])).toEqual([1]);
    expect(migrate(db, [first, second])).toEqual([2]);
  });

  it("rejects an already-applied migration that was edited", () => {
    const db = openDatabase(":memory:");
    migrate(db, [{ id: 1, name: "a", sql: "CREATE TABLE a (x INTEGER)" }]);
    expect(() => migrate(db, [{ id: 1, name: "a", sql: "CREATE TABLE a (x TEXT)" }])).toThrow(/checksum/i);
  });

  it("rolls back a failing migration completely", () => {
    const db = openDatabase(":memory:");
    const broken: Migration = { id: 1, name: "broken", sql: "CREATE TABLE ok (x INTEGER); THIS IS NOT SQL;" };
    expect(() => migrate(db, [broken])).toThrow();
    expect(tableNames(db)).not.toContain("ok");
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()).toEqual({ n: 0 });
  });

  it("rejects out-of-order ids", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      migrate(db, [
        { id: 2, name: "b", sql: "SELECT 1" },
        { id: 1, name: "a", sql: "SELECT 1" },
      ]),
    ).toThrow(/increasing/);
  });
});

describe("schema constraints", () => {
  const insertUser = (db: ReturnType<typeof openDatabase>, email: string, role: string) =>
    db
      .prepare("INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES (?, 'h', 'n', ?, 't')")
      .run(email, role);

  it("rejects unknown roles", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    expect(() => insertUser(db, "a@example.com", "superuser")).toThrow();
  });

  it("treats emails as case-insensitively unique", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    insertUser(db, "A@example.com", "client");
    expect(() => insertUser(db, "a@EXAMPLE.com", "client")).toThrow();
  });

  it("deletes sessions with their user", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    insertUser(db, "a@example.com", "client");
    db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('x', 1, 't', 't')").run();
    db.prepare("DELETE FROM users WHERE id = 1").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });
});

describe("migrations that rebuild tables", () => {
  it("rebuilds accounts without losing ledger data and keeps foreign keys on", () => {
    const db = openDatabase(":memory:");
    migrate(db, MIGRATIONS.slice(0, 4));
    db.prepare("INSERT INTO users (email, password_hash, display_name, role, created_at) VALUES ('a@x.com', 'h', 'A', 'client', 't')").run();
    db.prepare("INSERT INTO accounts (kind, user_id) VALUES ('user_wallet', 1)").run();
    db.prepare("INSERT INTO journal_entries (kind, memo, created_at) VALUES ('deposit', 'm', 't')").run();
    db.prepare("INSERT INTO ledger_lines (entry_id, account_id, amount_cents) VALUES (1, 1, -500), (1, 3, 500)").run();

    expect(migrate(db)).toEqual(MIGRATIONS.slice(4).map((migration) => migration.id));

    expect(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT SUM(amount_cents) AS total FROM ledger_lines WHERE account_id = 3").get()).toEqual({ total: 500 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(() => db.prepare("DELETE FROM accounts WHERE id = 3").run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("UPDATE ledger_lines SET amount_cents = 1").run()).toThrow(/append-only/);
  });

  it("rolls back and restores foreign keys when the rebuild leaves a violation", () => {
    const db = openDatabase(":memory:");
    const broken: Migration = {
      id: 1,
      name: "broken_rebuild",
      rebuildsTables: true,
      sql: `
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent (id));
        INSERT INTO child (parent_id) VALUES (99);
      `,
    };
    expect(() => migrate(db, [broken])).toThrow(/foreign key violation/);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(tableNames(db)).not.toContain("parent");
  });
});
