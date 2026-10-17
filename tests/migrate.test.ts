import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { migrate, type Migration } from "../src/db/migrate.js";

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe("migrate", () => {
  it("creates the schema and records applied migrations", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db)).toEqual([1]);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["users", "sessions", "audit_log", "schema_migrations"]));
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
