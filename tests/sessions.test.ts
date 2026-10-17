import { beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  deleteUserSessions,
  resolveSession,
} from "../src/auth/sessions.js";
import { setDisabled, type User } from "../src/auth/users.js";
import { makeTestApp, seedUser, type TestContext } from "./helpers.js";

describe("sessions", () => {
  let ctx: TestContext;
  let user: User;
  const start = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(async () => {
    ctx = makeTestApp();
    user = await seedUser(ctx, "sam@example.com", "client");
  });

  it("resolves a fresh token to its user", () => {
    const { token } = createSession(ctx.db, user.id, 1, start);
    expect(resolveSession(ctx.db, token, start)?.id).toBe(user.id);
  });

  it("stores only a hash of the token", () => {
    const { token } = createSession(ctx.db, user.id, 1, start);
    const row = ctx.db.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("expires at the ttl boundary", () => {
    const { token } = createSession(ctx.db, user.id, 1, start);
    expect(resolveSession(ctx.db, token, new Date("2026-01-01T00:59:59.000Z"))).toBeDefined();
    expect(resolveSession(ctx.db, token, new Date("2026-01-01T01:00:00.000Z"))).toBeUndefined();
  });

  it("does not resolve unknown tokens", () => {
    expect(resolveSession(ctx.db, "nope", start)).toBeUndefined();
  });

  it("does not resolve sessions of disabled users", () => {
    const { token } = createSession(ctx.db, user.id, 1, start);
    setDisabled(ctx.db, user.id, true);
    expect(resolveSession(ctx.db, token, start)).toBeUndefined();
  });

  it("deletes one session, all of a user's sessions, and expired sessions", () => {
    const a = createSession(ctx.db, user.id, 1, start);
    const b = createSession(ctx.db, user.id, 1, start);
    deleteSession(ctx.db, a.token);
    expect(resolveSession(ctx.db, a.token, start)).toBeUndefined();
    expect(resolveSession(ctx.db, b.token, start)).toBeDefined();

    deleteUserSessions(ctx.db, user.id);
    expect(resolveSession(ctx.db, b.token, start)).toBeUndefined();

    createSession(ctx.db, user.id, 1, start);
    expect(deleteExpiredSessions(ctx.db, new Date("2026-01-02T00:00:00.000Z"))).toBe(1);
  });
});
