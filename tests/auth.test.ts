import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp, PASSWORD, seedUser, type TestContext } from "./helpers.js";

const register = (ctx: TestContext, body: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post("/api/auth/register")
    .send({ email: "Maya@Example.com", password: PASSWORD, displayName: "Maya", ...body });

describe("registration", () => {
  let ctx: TestContext;
  beforeEach(() => {
    ctx = makeTestApp();
  });

  it("creates a user, normalizes the email and signs them in with an HttpOnly cookie", async () => {
    const response = await register(ctx);
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: "maya@example.com", role: "client", displayName: "Maya" });
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toMatch(/artshelf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("never returns the password hash", async () => {
    const response = await register(ctx);
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
  });

  it("lets a person register as an artist", async () => {
    const response = await register(ctx, { role: "artist" });
    expect(response.body.user.role).toBe("artist");
  });

  it.each(["admin", "moderator"])("refuses self-registration as %s", async (role) => {
    const response = await register(ctx, { role });
    expect(response.status).toBe(400);
  });

  it("rejects short and oversized passwords", async () => {
    expect((await register(ctx, { password: "short" })).status).toBe(400);
    expect((await register(ctx, { password: "x".repeat(73) })).status).toBe(400);
  });

  it("rejects invalid emails and missing fields", async () => {
    expect((await register(ctx, { email: "not-an-email" })).status).toBe(400);
    expect((await register(ctx, { displayName: "" })).status).toBe(400);
  });

  it("rejects a duplicate email regardless of case", async () => {
    expect((await register(ctx)).status).toBe(201);
    const duplicate = await register(ctx, { email: "maya@example.com" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("email_taken");
  });

  it("records an audit entry", async () => {
    await register(ctx);
    const row = ctx.db.prepare("SELECT action FROM audit_log").get();
    expect(row).toEqual({ action: "user.register" });
  });
});

describe("login, session and logout", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "lee@example.com", "artist");
  });

  it("signs in with correct credentials and unlocks /me", async () => {
    const agent = request.agent(ctx.app);
    const login = await agent.post("/api/auth/login").send({ email: "LEE@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("lee@example.com");
  });

  it("gives the same response for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "lee@example.com", password: "wrong password here" });
    const unknownEmail = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "ghost@example.com", password: "wrong password here" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it("requires authentication for /me", async () => {
    expect((await request(ctx.app).get("/api/auth/me")).status).toBe(401);
  });

  it("ignores forged or garbage session cookies", async () => {
    const response = await request(ctx.app).get("/api/auth/me").set("Cookie", "artshelf_session=forged-token");
    expect(response.status).toBe(401);
  });

  it("invalidates the session on logout, even if the old cookie is replayed", async () => {
    const agent = request.agent(ctx.app);
    const login = await agent.post("/api/auth/login").send({ email: "lee@example.com", password: PASSWORD });
    const cookie = String(login.headers["set-cookie"]).split(";")[0] ?? "";
    expect(cookie).toMatch(/^artshelf_session=/);
    expect((await agent.post("/api/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    const replay = await request(ctx.app).get("/api/auth/me").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });
});

describe("request hardening", () => {
  it("returns 400 for malformed JSON", async () => {
    const ctx = makeTestApp();
    const response = await request(ctx.app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const response = await request(makeTestApp().app).get("/api/nope");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("rejects state-changing requests from another origin", async () => {
    const ctx = makeTestApp();
    const response = await request(ctx.app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: "a@example.com", password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("cross_origin");
  });

  it("allows requests whose Origin matches the Host", async () => {
    const ctx = makeTestApp();
    await seedUser(ctx, "ok@example.com", "client");
    const response = await request(ctx.app)
      .post("/api/auth/login")
      .set("Host", "shop.example")
      .set("Origin", "https://shop.example")
      .send({ email: "ok@example.com", password: PASSWORD });
    expect(response.status).toBe(200);
  });

  it("sets security headers and hides the framework", async () => {
    const response = await request(makeTestApp().app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("rate limits repeated login attempts", async () => {
    const ctx = makeTestApp({ LOGIN_RATE_LIMIT_MAX: "3" });
    const attempt = () => request(ctx.app).post("/api/auth/login").send({ email: "a@example.com", password: "whatever12345" });
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("rate_limited");
  });
});
