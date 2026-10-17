import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestApp, seedArtist, seedUser, signedInAgent, type TestContext } from "./helpers.js";

describe("artist profile routes", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "admin@example.com", "admin");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "client@example.com", "client");
    await seedUser(ctx, "new@example.com", "artist");
  });

  it("lists categories publicly with their upload rules", async () => {
    const response = await request(ctx.app).get("/api/categories");
    expect(response.status).toBe(200);
    const sound = response.body.categories.find((category: { slug: string }) => category.slug === "sound");
    expect(sound.allowedMimeTypes).toEqual(["audio/wav", "audio/mpeg"]);
  });

  it("lets an artist create and read their profile, starting as pending", async () => {
    const agent = await signedInAgent(ctx, "new@example.com");
    expect((await agent.get("/api/artists/me")).status).toBe(404);
    const created = await agent.put("/api/artists/me").send({ bio: "I draw.", specialty: "character-illustration" });
    expect(created.status).toBe(200);
    expect(created.body.profile).toMatchObject({ status: "pending", tier: "standard" });
    expect((await agent.get("/api/artists/me")).body.profile.bio).toBe("I draw.");
  });

  it("forbids clients and anonymous callers from writing profiles", async () => {
    const client = await signedInAgent(ctx, "client@example.com");
    expect((await client.put("/api/artists/me").send({ bio: "x", specialty: "design" })).status).toBe(403);
    expect((await request(ctx.app).put("/api/artists/me").send({ bio: "x", specialty: "design" })).status).toBe(401);
  });

  it("validates the profile body", async () => {
    const agent = await signedInAgent(ctx, "new@example.com");
    expect((await agent.put("/api/artists/me").send({ bio: "", specialty: "design" })).status).toBe(400);
    expect((await agent.put("/api/artists/me").send({ bio: "x".repeat(2001), specialty: "design" })).status).toBe(400);
    expect((await agent.put("/api/artists/me").send({ bio: "ok", specialty: "pottery" })).status).toBe(400);
  });

  it("hides pending profiles from the public but shows them to the owner and moderators", async () => {
    const pending = await seedArtist(ctx, "wait@example.com", { approved: false });
    const url = `/api/artists/${pending.id}`;
    expect((await request(ctx.app).get(url)).status).toBe(404);
    expect((await (await signedInAgent(ctx, "client@example.com")).get(url)).status).toBe(404);
    expect((await (await signedInAgent(ctx, "wait@example.com")).get(url)).status).toBe(200);
    expect((await (await signedInAgent(ctx, "mod@example.com")).get(url)).status).toBe(200);
    expect((await request(ctx.app).get("/api/artists")).body.artists).toEqual([]);
  });

  it("shows approved profiles publicly and filters the listing", async () => {
    const a = await seedArtist(ctx, "a@example.com", { specialty: "sound" });
    await seedArtist(ctx, "b@example.com", { specialty: "video" });
    expect((await request(ctx.app).get(`/api/artists/${a.id}`)).status).toBe(200);
    const filtered = await request(ctx.app).get("/api/artists?category=sound");
    expect(filtered.body.artists).toHaveLength(1);
    expect((await request(ctx.app).get("/api/artists?limit=0")).status).toBe(400);
  });
});

describe("moderation and tiers", () => {
  let ctx: TestContext;
  let artistId: number;
  beforeEach(async () => {
    ctx = makeTestApp();
    await seedUser(ctx, "admin@example.com", "admin");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "client@example.com", "client");
    artistId = (await seedArtist(ctx, "wait@example.com", { approved: false })).id;
  });

  it("denies non-moderators and anonymous callers", async () => {
    const urls = [`/api/moderation/artists/${artistId}/approve`, `/api/moderation/artists/${artistId}/reject`];
    for (const url of urls) {
      expect((await request(ctx.app).post(url)).status).toBe(401);
      expect((await (await signedInAgent(ctx, "client@example.com")).post(url)).status).toBe(403);
      expect((await (await signedInAgent(ctx, "wait@example.com")).post(url)).status).toBe(403);
    }
    expect((await (await signedInAgent(ctx, "client@example.com")).get("/api/moderation/artists")).status).toBe(403);
  });

  it("lets a moderator list the queue, approve, and audits it", async () => {
    const mod = await signedInAgent(ctx, "mod@example.com");
    expect((await mod.get("/api/moderation/artists")).body.artists).toHaveLength(1);
    const approved = await mod.post(`/api/moderation/artists/${artistId}/approve`);
    expect(approved.body.profile.status).toBe("approved");
    expect((await request(ctx.app).get(`/api/artists/${artistId}`)).status).toBe(200);
    const row = ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'artist.approved'").get();
    expect(row).toEqual({ action: "artist.approved" });
  });

  it("rejects with a reason, then the artist resubmits by editing", async () => {
    const mod = await signedInAgent(ctx, "mod@example.com");
    const rejected = await mod.post(`/api/moderation/artists/${artistId}/reject`).send({ reason: "Bio too thin" });
    expect(rejected.body.profile.status).toBe("rejected");
    const detail = ctx.db.prepare("SELECT detail FROM audit_log WHERE action = 'artist.rejected'").get() as { detail: string };
    expect(JSON.parse(detail.detail)).toEqual({ reason: "Bio too thin" });

    const artist = await signedInAgent(ctx, "wait@example.com");
    const resubmitted = await artist.put("/api/artists/me").send({ bio: "A much longer bio", specialty: "illustration" });
    expect(resubmitted.body.profile.status).toBe("pending");
  });

  it("reports invalid transitions and unknown artists", async () => {
    const mod = await signedInAgent(ctx, "mod@example.com");
    await mod.post(`/api/moderation/artists/${artistId}/approve`);
    const again = await mod.post(`/api/moderation/artists/${artistId}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("invalid_transition");
    expect((await mod.post("/api/moderation/artists/999/approve")).status).toBe(404);
    expect((await mod.post("/api/moderation/artists/abc/approve")).status).toBe(400);
  });

  it("lets only admins change tiers", async () => {
    const mod = await signedInAgent(ctx, "mod@example.com");
    expect((await mod.patch(`/api/admin/artists/${artistId}/tier`).send({ tier: "premium" })).status).toBe(403);
    const admin = await signedInAgent(ctx, "admin@example.com");
    expect((await admin.patch(`/api/admin/artists/${artistId}/tier`).send({ tier: "gold" })).status).toBe(400);
    const changed = await admin.patch(`/api/admin/artists/${artistId}/tier`).send({ tier: "premium" });
    expect(changed.body.profile.tier).toBe("premium");
    expect((await admin.patch("/api/admin/artists/999/tier").send({ tier: "premium" })).status).toBe(404);
  });
});
