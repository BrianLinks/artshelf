import { readdirSync } from "node:fs";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { setDisabled } from "../src/auth/users.js";
import { makePng, makeTestApp, seedArtist, seedUser, signedInAgent, upload, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;

async function newAsset(agent: Agent, category: string, color: number): Promise<number> {
  const response = await upload(agent, { category, filename: `art-${color}.png`, data: await makePng(color, 40, 40) });
  expect(response.status).toBe(201);
  return response.body.asset.id;
}

const body = (assetId: number, overrides: Record<string, unknown> = {}) => ({
  assetId,
  title: "Forest Spirit",
  description: "A watercolor spirit",
  basePriceCents: 50_000,
  licenses: ["non_commercial", "commercial"],
  tags: ["forest", "spirit"],
  ...overrides,
});

describe("listings", () => {
  let ctx: TestContext;
  let artist: Agent;
  let other: Agent;
  let client: Agent;
  let mod: Agent;
  let artistId: number;

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    await seedArtist(ctx, "other@example.com");
    await seedUser(ctx, "client@example.com", "client");
    await seedUser(ctx, "mod@example.com", "moderator");
    artist = await signedInAgent(ctx, "artist@example.com");
    other = await signedInAgent(ctx, "other@example.com");
    client = await signedInAgent(ctx, "client@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");
  });

  async function publishedListing(category = "illustration", color = 10, overrides: Record<string, unknown> = {}) {
    const assetId = await newAsset(artist, category, color);
    const created = await artist.post("/api/listings").send(body(assetId, overrides));
    expect(created.status).toBe(201);
    const published = await artist.post(`/api/listings/${created.body.listing.id}/publish`);
    expect(published.status).toBe(200);
    return published.body.listing as { id: number };
  }

  it("publishes the license definitions", async () => {
    const response = await request(ctx.app).get("/api/licenses");
    expect(response.status).toBe(200);
    expect(response.body.licenses.map((license: { type: string }) => license.type)).toEqual([
      "non_commercial",
      "commercial",
      "broadcast",
    ]);
    expect(response.body.uses).toContain("resale_as_is");
  });

  describe("creating", () => {
    it("creates a private draft with computed license prices", async () => {
      const assetId = await newAsset(artist, "illustration", 1);
      const response = await artist.post("/api/listings").send(body(assetId));
      expect(response.status).toBe(201);
      expect(response.body.listing).toMatchObject({
        status: "draft",
        publiclyVisible: false,
        category: { slug: "illustration" },
        basePriceCents: 50_000,
        licenses: [
          { license: "non_commercial", priceCents: 50_000 },
          { license: "commercial", priceCents: 125_000 },
        ],
        tags: ["forest", "spirit"],
        artist: { displayName: "artist", tier: "standard" },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/assetId|stored|thumb_name/);
      const id = response.body.listing.id;
      expect((await request(ctx.app).get(`/api/listings/${id}`)).status).toBe(404);
      expect((await artist.get(`/api/listings/${id}`)).status).toBe(200);
      expect((await request(ctx.app).get("/api/listings")).body.total).toBe(0);
    });

    it("normalizes and de-duplicates tags", async () => {
      const assetId = await newAsset(artist, "illustration", 2);
      const response = await artist.post("/api/listings").send(body(assetId, { tags: ["Forest", "forest", " spirit "] }));
      expect(response.body.listing.tags).toEqual(["forest", "spirit"]);
    });

    it.each([
      ["a price below $1.00", { basePriceCents: 99 }],
      ["a price above $100,000.00", { basePriceCents: 10_000_001 }],
      ["a fractional price", { basePriceCents: 500.5 }],
      ["no licenses", { licenses: [] }],
      ["duplicate licenses", { licenses: ["commercial", "commercial"] }],
      ["an unknown license", { licenses: ["exclusive"] }],
      ["an empty title", { title: "  " }],
      ["a bad tag", { tags: ["Not Valid!"] }],
      ["too many tags", { tags: Array.from({ length: 11 }, (_, index) => `tag${index}`) }],
    ])("rejects %s", async (_label, overrides) => {
      const assetId = await newAsset(artist, "illustration", 3);
      expect((await artist.post("/api/listings").send(body(assetId, overrides))).status).toBe(400);
    });

    it("requires an artist and an asset they own", async () => {
      const assetId = await newAsset(artist, "illustration", 4);
      expect((await request(ctx.app).post("/api/listings").send(body(assetId))).status).toBe(401);
      expect((await client.post("/api/listings").send(body(assetId))).status).toBe(403);
      const stolen = await other.post("/api/listings").send(body(assetId));
      expect(stolen.status).toBe(400);
      expect(stolen.body.error.code).toBe("invalid_asset");
      expect((await artist.post("/api/listings").send(body(9999))).status).toBe(400);
    });

    it("allows one listing per asset", async () => {
      const assetId = await newAsset(artist, "illustration", 5);
      expect((await artist.post("/api/listings").send(body(assetId))).status).toBe(201);
      const again = await artist.post("/api/listings").send(body(assetId));
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("asset_already_listed");
    });

    it("records an audit entry", async () => {
      await publishedListing();
      const actions = ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'listing.%' ORDER BY id").all();
      expect(actions).toEqual([{ action: "listing.created" }, { action: "listing.published" }]);
    });
  });

  describe("publishing and visibility", () => {
    it("shows a published listing publicly, with a preview, and hides it again on unpublish", async () => {
      const listing = await publishedListing();
      const detail = await request(ctx.app).get(`/api/listings/${listing.id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.listing.asset.previewUrl).toBe(`/api/listings/${listing.id}/preview`);
      const preview = await request(ctx.app).get(`/api/listings/${listing.id}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.headers["content-type"]).toBe("image/webp");
      expect((await request(ctx.app).get("/api/listings")).body.total).toBe(1);

      expect((await artist.post(`/api/listings/${listing.id}/unpublish`)).body.listing.status).toBe("draft");
      expect((await request(ctx.app).get(`/api/listings/${listing.id}`)).status).toBe(404);
      expect((await request(ctx.app).get(`/api/listings/${listing.id}/preview`)).status).toBe(404);
      expect((await request(ctx.app).get("/api/listings")).body.total).toBe(0);
    });

    it("blocks publishing until the artist profile is approved", async () => {
      await seedArtist(ctx, "pending@example.com", { approved: false });
      const pending = await signedInAgent(ctx, "pending@example.com");
      const assetId = await newAsset(pending, "illustration", 20);
      const created = await pending.post("/api/listings").send(body(assetId));
      expect(created.status).toBe(201);
      const publish = await pending.post(`/api/listings/${created.body.listing.id}/publish`);
      expect(publish.status).toBe(409);
      expect(publish.body.error.code).toBe("profile_not_approved");
    });

    it("hides listings of disabled artists", async () => {
      const listing = await publishedListing();
      setDisabled(ctx.db, artistId, true);
      expect((await request(ctx.app).get(`/api/listings/${listing.id}`)).status).toBe(404);
      expect((await request(ctx.app).get("/api/listings")).body.total).toBe(0);
    });

    it("rejects invalid state changes", async () => {
      const listing = await publishedListing();
      const again = await artist.post(`/api/listings/${listing.id}/publish`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("invalid_listing_state");
    });

    it("only lets the owner manage a listing, and hides it from others with a 404", async () => {
      const listing = await publishedListing();
      expect((await other.put(`/api/listings/${listing.id}`).send(body(1))).status).toBe(404);
      expect((await other.post(`/api/listings/${listing.id}/unpublish`)).status).toBe(404);
      expect((await client.post(`/api/listings/${listing.id}/publish`)).status).toBe(403);
      expect((await request(ctx.app).post(`/api/listings/${listing.id}/unpublish`)).status).toBe(401);
    });

    it("lists the artist's own listings, including drafts", async () => {
      await publishedListing("illustration", 30);
      const assetId = await newAsset(artist, "illustration", 31);
      await artist.post("/api/listings").send(body(assetId));
      expect((await artist.get("/api/listings/mine")).body.listings).toHaveLength(2);
      expect((await other.get("/api/listings/mine")).body.listings).toHaveLength(0);
      expect((await client.get("/api/listings/mine")).status).toBe(403);
    });
  });

  describe("editing", () => {
    it("replaces price, licenses and tags", async () => {
      const listing = await publishedListing();
      const updated = await artist.put(`/api/listings/${listing.id}`).send({
        title: "Renamed",
        basePriceCents: 20_000,
        licenses: ["broadcast"],
        tags: ["new"],
      });
      expect(updated.status).toBe(200);
      expect(updated.body.listing).toMatchObject({
        title: "Renamed",
        description: "",
        basePriceCents: 20_000,
        licenses: [{ license: "broadcast", priceCents: 100_000 }],
        tags: ["new"],
        status: "published",
      });
    });

    it("validates edits", async () => {
      const listing = await publishedListing();
      expect((await artist.put(`/api/listings/${listing.id}`).send({ title: "x", basePriceCents: 5, licenses: ["commercial"] })).status).toBe(400);
      expect((await artist.put("/api/listings/abc").send({ title: "x", basePriceCents: 500, licenses: ["commercial"] })).status).toBe(400);
    });
  });

  describe("browsing", () => {
    beforeEach(async () => {
      await publishedListing("illustration", 40, { title: "Cheap", basePriceCents: 1_000, licenses: ["non_commercial"], tags: ["cat"] });
      await publishedListing("illustration", 41, { title: "Middle", basePriceCents: 5_000, licenses: ["commercial"], tags: ["dog"] });
      await publishedListing("character-illustration", 42, { title: "Dear", basePriceCents: 90_000, licenses: ["broadcast", "commercial"], tags: ["cat", "hero"] });
    });

    const titles = async (query: string) =>
      ((await request(ctx.app).get(`/api/listings${query}`)).body.listings as { title: string }[]).map((l) => l.title);

    it("returns newest first by default, with totals", async () => {
      const response = await request(ctx.app).get("/api/listings");
      expect(response.body.total).toBe(3);
      expect(await titles("")).toEqual(["Dear", "Middle", "Cheap"]);
    });

    it("sorts by price", async () => {
      expect(await titles("?sort=price_asc")).toEqual(["Cheap", "Middle", "Dear"]);
      expect(await titles("?sort=price_desc")).toEqual(["Dear", "Middle", "Cheap"]);
    });

    it("filters by category, license, price range, tag and artist", async () => {
      expect(await titles("?category=character-illustration")).toEqual(["Dear"]);
      expect(await titles("?license=commercial&sort=price_asc")).toEqual(["Middle", "Dear"]);
      expect(await titles("?minPriceCents=2000&maxPriceCents=10000")).toEqual(["Middle"]);
      expect(await titles("?tag=cat&sort=price_asc")).toEqual(["Cheap", "Dear"]);
      expect(await titles(`?artist=${artistId}`)).toHaveLength(3);
      expect(await titles("?artist=999")).toEqual([]);
    });

    it("paginates while reporting the full total", async () => {
      const page = await request(ctx.app).get("/api/listings?sort=price_asc&limit=1&offset=1");
      expect(page.body.total).toBe(3);
      expect(page.body.listings.map((l: { title: string }) => l.title)).toEqual(["Middle"]);
    });

    it("rejects bad query parameters", async () => {
      for (const query of ["?limit=0", "?limit=101", "?sort=random", "?license=exclusive", "?minPriceCents=-1", "?tag=Bad%20Tag"]) {
        expect((await request(ctx.app).get(`/api/listings${query}`)).status).toBe(400);
      }
    });
  });

  describe("license checks", () => {
    it("answers whether a use is allowed under an offered license", async () => {
      const listing = await publishedListing("illustration", 50, { licenses: ["non_commercial", "commercial"] });
      const check = async (license: string, use: string) =>
        (await request(ctx.app).get(`/api/listings/${listing.id}/license-check?license=${license}&use=${use}`)).body;
      expect(await check("commercial", "advertising")).toMatchObject({ offered: true, allowed: true });
      expect(await check("non_commercial", "advertising")).toMatchObject({ offered: true, allowed: false });
      expect(await check("broadcast", "broadcast")).toMatchObject({ offered: false, allowed: false });
      expect(await check("commercial", "resale_as_is")).toMatchObject({ allowed: false });
      expect((await request(ctx.app).get(`/api/listings/${listing.id}/license-check?license=commercial&use=nope`)).status).toBe(400);
    });
  });

  describe("moderation", () => {
    it("lets a moderator remove a listing permanently", async () => {
      const listing = await publishedListing();
      expect((await artist.post(`/api/moderation/listings/${listing.id}/remove`)).status).toBe(403);
      expect((await client.post(`/api/moderation/listings/${listing.id}/remove`)).status).toBe(403);
      const removed = await mod.post(`/api/moderation/listings/${listing.id}/remove`).send({ reason: "Stolen art" });
      expect(removed.body.listing.status).toBe("removed");

      expect((await request(ctx.app).get(`/api/listings/${listing.id}`)).status).toBe(404);
      expect((await mod.get(`/api/listings/${listing.id}`)).status).toBe(200);
      expect((await artist.get(`/api/listings/${listing.id}`)).status).toBe(200);
      const republish = await artist.post(`/api/listings/${listing.id}/publish`);
      expect(republish.status).toBe(409);
      expect((await artist.put(`/api/listings/${listing.id}`).send({ title: "x", basePriceCents: 500, licenses: ["commercial"] })).status).toBe(409);
      expect((await mod.post(`/api/moderation/listings/${listing.id}/remove`)).status).toBe(409);
      expect((await mod.post("/api/moderation/listings/999/remove")).status).toBe(404);

      const audit = ctx.db.prepare("SELECT detail FROM audit_log WHERE action = 'listing.removed'").get() as { detail: string };
      expect(JSON.parse(audit.detail)).toEqual({ reason: "Stolen art" });
    });
  });

  describe("assets used by listings", () => {
    it("cannot be deleted while a listing references them", async () => {
      const assetId = await newAsset(artist, "illustration", 60);
      await artist.post("/api/listings").send(body(assetId));
      const blocked = await artist.delete(`/api/assets/${assetId}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("asset_in_use");
      expect(readdirSync(ctx.uploadDir)).toHaveLength(2);
    });
  });
});
