import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createPublishedListing, makeTestApp, seedArtist, seedUser, signedInAgent, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

describe("copyright takedowns", () => {
  let ctx: TestContext;
  let artist: Agent;
  let claimant: Agent;
  let rival: Agent;
  let mod: Agent;
  let admin: Agent;
  let bystander: Agent;
  let claimantId: number;
  let artistId: number;
  let listingId: number;

  const notice = (agent: Agent = claimant, overrides: Record<string, unknown> = {}) =>
    agent.post("/api/takedowns").send({
      listingId,
      workDescription: "This copies my illustration 'Forest Spirit', published in 2024.",
      originalUrl: "https://example.com/my-portfolio/forest-spirit",
      goodFaithStatement: true,
      accuracyStatement: true,
      signature: "Casey Claimant",
      ...overrides,
    });
  const staff = (agent: Agent, id: number, action: string, note?: string) =>
    agent.post(`/api/moderation/takedowns/${id}/${action}`).send(note ? { note } : {});
  const counter = (agent: Agent, id: number, overrides: Record<string, unknown> = {}) =>
    agent.post(`/api/takedowns/${id}/counter`).send({
      statement: "I created this work myself and have the sketches to prove it.",
      goodFaithStatement: true,
      signature: "Artist Name",
      ...overrides,
    });
  const filed = async (): Promise<number> => {
    const response = await notice();
    expect(response.status).toBe(201);
    return response.body.notice.id;
  };
  const listingView = async (agent: Agent) => (await agent.get(`/api/listings/${listingId}`)).body.listing;
  const kindsFor = async (agent: Agent) =>
    ((await agent.get("/api/notifications")).body.notifications as { kind: string }[]).map((n) => n.kind);

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    await seedArtist(ctx, "rival@example.com");
    claimantId = (await seedUser(ctx, "claimant@example.com", "client")).id;
    await seedUser(ctx, "bystander@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    await seedUser(ctx, "admin@example.com", "admin");
    artist = await signedInAgent(ctx, "artist@example.com");
    rival = await signedInAgent(ctx, "rival@example.com");
    claimant = await signedInAgent(ctx, "claimant@example.com");
    bystander = await signedInAgent(ctx, "bystander@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
    admin = await signedInAgent(ctx, "admin@example.com");
    listingId = (await createPublishedListing(artist)).id;
  });

  describe("filing a notice", () => {
    it("records the sworn statements and signature", async () => {
      const response = await notice();
      expect(response.status).toBe(201);
      expect(response.body.notice).toMatchObject({
        status: "received",
        listing: { id: listingId, title: "Test Artwork" },
        claimant: { userId: claimantId },
        artistUserId: artistId,
        signature: "Casey Claimant",
        originalUrl: "https://example.com/my-portfolio/forest-spirit",
      });
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).body.listing.status).toBe("published");
    });

    it.each([
      ["no good-faith statement", { goodFaithStatement: false }],
      ["a missing accuracy statement", { accuracyStatement: undefined }],
      ["no signature", { signature: " " }],
      ["a thin description", { workDescription: "Copied" }],
      ["a bad link", { originalUrl: "not a url" }],
      ["a non-numeric listing", { listingId: "abc" }],
    ])("rejects %s", async (_label, overrides) => {
      expect((await notice(claimant, overrides)).status).toBe(400);
    });

    it("needs sign-in and refuses unfit targets", async () => {
      expect((await request(ctx.app).post("/api/takedowns").send({ listingId })).status).toBe(401);
      const own = await notice(artist);
      expect(own.status).toBe(409);
      expect(own.body.error.code).toBe("cannot_claim_own_listing");
      expect((await notice(claimant, { listingId: 9999 })).body.error.code).toBe("listing_unavailable");
    });

    it("allows one open notice per claimant and listing, but others may also file", async () => {
      await filed();
      const again = await notice();
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("notice_exists");
      expect((await notice(bystander)).status).toBe(201);
    });
  });

  describe("review by staff", () => {
    it("upholds a notice: the listing comes down and both sides are told", async () => {
      const id = await filed();
      expect((await staff(claimant, id, "uphold")).status).toBe(403);
      expect((await staff(artist, id, "uphold")).status).toBe(403);
      const upheld = await staff(mod, id, "uphold", "Original work predates the listing");
      expect(upheld.body.notice).toMatchObject({ status: "upheld", resolutionNote: "Original work predates the listing" });

      expect((await listingView(artist)).status).toBe("removed");
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).status).toBe(404);
      expect(await kindsFor(artist)).toContain("takedown_upheld");
      expect(await kindsFor(claimant)).toContain("takedown_upheld");
      const audit = ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'takedown.upheld'").get();
      expect(audit).toEqual({ action: "takedown.upheld" });
    });

    it("rejects a notice and leaves the listing alone", async () => {
      const id = await filed();
      const rejected = await staff(admin, id, "reject", "Different artwork");
      expect(rejected.body.notice.status).toBe("rejected");
      expect((await request(ctx.app).get(`/api/listings/${listingId}`)).status).toBe(200);
      expect(await kindsFor(claimant)).toContain("takedown_rejected");
      expect((await notice()).status).toBe(201);
    });

    it("shows the queue to staff only", async () => {
      const id = await filed();
      expect((await claimant.get("/api/moderation/takedowns")).status).toBe(403);
      const queue = (await mod.get("/api/moderation/takedowns")).body.notices as { id: number }[];
      expect(queue.map((n) => n.id)).toEqual([id]);
      await staff(mod, id, "reject");
      expect((await mod.get("/api/moderation/takedowns")).body.notices).toEqual([]);
      expect((await mod.get("/api/moderation/takedowns?status=rejected")).body.notices).toHaveLength(1);
      expect((await mod.get("/api/moderation/takedowns?status=bogus")).status).toBe(400);
    });

    it("follows the order of steps", async () => {
      const id = await filed();
      for (const action of ["reinstate", "close"]) expect((await staff(mod, id, action)).status).toBe(409);
      await staff(mod, id, "uphold");
      for (const action of ["uphold", "reject", "reinstate", "close"]) expect((await staff(mod, id, action)).status).toBe(409);
      expect((await staff(mod, 999, "uphold")).status).toBe(404);
    });

    it("still upholds when a moderator already removed the listing", async () => {
      const id = await filed();
      await mod.post(`/api/moderation/listings/${listingId}/remove`).send({});
      expect((await staff(mod, id, "uphold")).body.notice.status).toBe("upheld");
      expect((await listingView(artist)).status).toBe("removed");
    });

    it("refuses new notices against a listing that is already removed", async () => {
      await mod.post(`/api/moderation/listings/${listingId}/remove`).send({});
      const response = await notice();
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("listing_unavailable");
    });
  });

  describe("counter-notices", () => {
    it("lets the artist object to an upheld removal", async () => {
      const id = await filed();
      expect((await counter(artist, id)).status).toBe(409);
      await staff(mod, id, "uphold");
      expect((await counter(claimant, id)).status).toBe(403);
      expect((await counter(rival, id)).status).toBe(404);
      expect((await counter(artist, id, { goodFaithStatement: false })).status).toBe(400);
      expect((await counter(artist, id, { statement: "short" })).status).toBe(400);
      expect((await counter(artist, id, { signature: "" })).status).toBe(400);

      const response = await counter(artist, id);
      expect(response.body.notice).toMatchObject({
        status: "counter_noticed",
        counterSignature: "Artist Name",
        counterStatement: expect.stringContaining("sketches"),
      });
      expect(await kindsFor(claimant)).toContain("takedown_counter");
      expect((await counter(artist, id)).status).toBe(409);
    });

    it("reinstates the listing as a draft that the artist can publish again", async () => {
      const id = await filed();
      await staff(mod, id, "uphold");
      await counter(artist, id);
      expect((await artist.post(`/api/listings/${listingId}/unpublish`)).status).toBe(409);
      expect((await artist.post(`/api/listings/${listingId}/publish`)).status).toBe(409);

      const reinstated = await staff(admin, id, "reinstate", "Artist showed the sketches");
      expect(reinstated.body.notice.status).toBe("reinstated");
      expect((await listingView(artist)).status).toBe("draft");
      expect(await kindsFor(artist)).toContain("takedown_reinstated");
      expect(await kindsFor(claimant)).toContain("takedown_reinstated");
      expect((await artist.post(`/api/listings/${listingId}/publish`)).body.listing.status).toBe("published");
    });

    it("keeps the listing removed when staff close the case", async () => {
      const id = await filed();
      await staff(mod, id, "uphold");
      await counter(artist, id);
      expect((await staff(mod, id, "close", "Claim stands")).body.notice.status).toBe("closed");
      expect((await listingView(artist)).status).toBe("removed");
      expect((await artist.post(`/api/listings/${listingId}/publish`)).status).toBe(409);
      expect((await artist.post(`/api/listings/${listingId}/unpublish`)).status).toBe(409);
      expect(await kindsFor(artist)).toContain("takedown_closed");
    });
  });

  describe("access", () => {
    it("shows a notice to the claimant, the artist and staff only", async () => {
      const id = await filed();
      for (const agent of [claimant, artist, mod, admin]) expect((await agent.get(`/api/takedowns/${id}`)).status).toBe(200);
      expect((await bystander.get(`/api/takedowns/${id}`)).status).toBe(404);
      expect((await rival.get(`/api/takedowns/${id}`)).status).toBe(404);
      expect((await request(ctx.app).get(`/api/takedowns/${id}`)).status).toBe(401);
      expect((await claimant.get("/api/takedowns/999")).status).toBe(404);
    });

    it("lists notices you filed and notices against you", async () => {
      await filed();
      expect((await claimant.get("/api/takedowns/mine")).body.notices).toHaveLength(1);
      expect((await bystander.get("/api/takedowns/mine")).body.notices).toHaveLength(0);
      expect((await artist.get("/api/takedowns/against-me")).body.notices).toHaveLength(1);
      expect((await rival.get("/api/takedowns/against-me")).body.notices).toHaveLength(0);
      expect((await claimant.get("/api/takedowns/against-me")).status).toBe(403);
    });
  });
});
