import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp, PASSWORD, seedUser, signedInAgent, type TestContext } from "./helpers.js";

describe("admin routes: authorization", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "admin@example.com", "admin");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "artist@example.com", "artist");
    await seedUser(ctx, "client@example.com", "client");
  });

  it("rejects anonymous callers with 401 on every admin route", async () => {
    const responses = await Promise.all([
      request(ctx.app).get("/api/admin/users"),
      request(ctx.app).patch("/api/admin/users/1/role").send({ role: "client" }),
      request(ctx.app).post("/api/admin/users/1/disable"),
      request(ctx.app).post("/api/admin/users/1/enable"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });

  it.each(["client@example.com", "artist@example.com", "mod@example.com"])(
    "forbids %s from every admin route with 403",
    async (email) => {
      const agent = await signedInAgent(ctx, email);
      expect((await agent.get("/api/admin/users")).status).toBe(403);
      expect((await agent.patch("/api/admin/users/1/role").send({ role: "client" })).status).toBe(403);
      expect((await agent.post("/api/admin/users/1/disable")).status).toBe(403);
      expect((await agent.post("/api/admin/users/1/enable")).status).toBe(403);
    },
  );

  it("lets an admin list users without exposing password hashes", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    const response = await agent.get("/api/admin/users");
    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(4);
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
  });
});

describe("admin routes: behaviour", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "admin@example.com", "admin"); // id 1
    await seedUser(ctx, "artist@example.com", "artist"); // id 2
  });

  it("changes a role and writes an audit entry with before and after", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    const response = await agent.patch("/api/admin/users/2/role").send({ role: "moderator" });
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("moderator");
    const audit = ctx.db.prepare("SELECT actor_user_id, target_id, detail FROM audit_log WHERE action = 'user.role_changed'").get() as {
      actor_user_id: number;
      target_id: number;
      detail: string;
    };
    expect(audit.actor_user_id).toBe(1);
    expect(audit.target_id).toBe(2);
    expect(JSON.parse(audit.detail)).toEqual({ from: "artist", to: "moderator" });
  });

  it("applies a role change to the user's existing session immediately", async () => {
    const artist = await signedInAgent(ctx, "artist@example.com");
    expect((await artist.get("/api/admin/users")).status).toBe(403);
    const admin = await signedInAgent(ctx, "admin@example.com");
    await admin.patch("/api/admin/users/2/role").send({ role: "admin" });
    expect((await artist.get("/api/admin/users")).status).toBe(200);
  });

  it("does not audit a no-op role change", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    await agent.patch("/api/admin/users/2/role").send({ role: "artist" });
    const row = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.role_changed'").get();
    expect(row).toEqual({ n: 0 });
  });

  it("validates ids and roles", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    expect((await agent.patch("/api/admin/users/abc/role").send({ role: "client" })).status).toBe(400);
    expect((await agent.patch("/api/admin/users/-4/role").send({ role: "client" })).status).toBe(400);
    expect((await agent.patch("/api/admin/users/2/role").send({ role: "root" })).status).toBe(400);
    expect((await agent.patch("/api/admin/users/2/role").send({})).status).toBe(400);
  });

  it("returns 404 for an unknown user", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    expect((await agent.patch("/api/admin/users/999/role").send({ role: "client" })).status).toBe(404);
    expect((await agent.post("/api/admin/users/999/disable")).status).toBe(404);
  });

  it("stops admins from demoting or disabling themselves", async () => {
    const agent = await signedInAgent(ctx, "admin@example.com");
    const demote = await agent.patch("/api/admin/users/1/role").send({ role: "client" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("cannot_modify_self");
    expect((await agent.post("/api/admin/users/1/disable")).status).toBe(409);
  });

  it("disabling a user ends their sessions and blocks new logins until re-enabled", async () => {
    const artist = await signedInAgent(ctx, "artist@example.com");
    const admin = await signedInAgent(ctx, "admin@example.com");

    expect((await admin.post("/api/admin/users/2/disable")).status).toBe(200);
    expect((await artist.get("/api/auth/me")).status).toBe(401);
    const blocked = await request(ctx.app).post("/api/auth/login").send({ email: "artist@example.com", password: PASSWORD });
    expect(blocked.status).toBe(401);

    expect((await admin.post("/api/admin/users/2/enable")).status).toBe(200);
    const allowed = await request(ctx.app).post("/api/auth/login").send({ email: "artist@example.com", password: PASSWORD });
    expect(allowed.status).toBe(200);
  });
});
