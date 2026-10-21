import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorage } from "../src/assets/storage.js";
import { setDisabled } from "../src/auth/users.js";
import { backfillPalettes, rebuildSearchIndex } from "../src/search/indexer.js";
import { fakeZip, makePng, makeTestApp, seedArtist, seedUser, signedInAgent, upload, type TestContext } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Made {
  id: number;
  assetId: number;
}

describe("search", () => {
  let ctx: TestContext;
  let artist: Agent;
  let zed: Agent;
  let mod: Agent;
  let artistId: number;
  let crimson: Made;
  let ocean: Made;
  let forest: Made;
  let sunset: Made;
  let rose: Made;
  let owl: Made;

  const make = async (
    agent: Agent,
    options: {
      title: string;
      description?: string;
      tags?: string[];
      category?: string;
      color: [number, number, number];
      price?: number;
      licenses?: string[];
      publish?: boolean;
    },
  ): Promise<Made> => {
    const uploaded = await upload(agent, {
      category: options.category ?? "illustration",
      filename: `${options.title}.png`,
      data: await makePng(...options.color),
    });
    expect(uploaded.status).toBe(201);
    const created = await agent.post("/api/listings").send({
      assetId: uploaded.body.asset.id,
      title: options.title,
      description: options.description ?? "",
      basePriceCents: options.price ?? 10_000,
      licenses: options.licenses ?? ["commercial"],
      tags: options.tags ?? [],
    });
    expect(created.status).toBe(201);
    if (options.publish ?? true) expect((await agent.post(`/api/listings/${created.body.listing.id}/publish`)).status).toBe(200);
    return { id: created.body.listing.id, assetId: uploaded.body.asset.id };
  };

  const search = async (query: string) => (await request(ctx.app).get(`/api/search${query ? `?${query}` : ""}`)).body;
  const ids = async (query: string): Promise<number[]> => (await search(query)).listings.map((l: { id: number }) => l.id);

  beforeEach(async () => {
    ctx = makeTestApp();
    artistId = (await seedArtist(ctx, "artist@example.com")).id;
    await seedArtist(ctx, "zed@example.com");
    await seedUser(ctx, "mod@example.com", "moderator");
    artist = await signedInAgent(ctx, "artist@example.com");
    zed = await signedInAgent(ctx, "zed@example.com");
    mod = await signedInAgent(ctx, "mod@example.com");

    crimson = await make(artist, { title: "Crimson Dragon", description: "A fierce beast breathing fire", tags: ["dragon", "fantasy"], color: [220, 20, 20], price: 50_000 });
    ocean = await make(artist, { title: "Ocean Whale", description: "Calm sea creature", tags: ["sea"], color: [20, 40, 220], price: 20_000 });
    forest = await make(artist, {
      title: "Forest Spirit",
      description: "A gentle guardian, older than the dragon of the glade",
      category: "character-illustration",
      color: [20, 200, 40],
      price: 90_000,
      licenses: ["broadcast", "commercial"],
    });
    sunset = await make(artist, { title: "Sunset Cat", description: "Warm orange cat", tags: ["cat"], color: [240, 140, 20], price: 10_000, licenses: ["non_commercial"] });
    rose = await make(artist, { title: "Rose Garden", description: "Petals", tags: ["flower"], color: [200, 40, 50], price: 30_000 });
    owl = await make(zed, { title: "Night Owl", description: "Quiet", category: "character-illustration", color: [30, 30, 60], price: 40_000 });
  });

  describe("text search", () => {
    it("finds listings by title, tags and description, best match first", async () => {
      expect(await ids("q=dragon")).toEqual([crimson.id, forest.id]);
    });

    it("matches prefixes, ignoring case and accents", async () => {
      expect(await ids("q=drag")).toEqual([crimson.id, forest.id]);
      expect(await ids("q=DRAGON")).toEqual([crimson.id, forest.id]);
      expect(await ids(`q=${encodeURIComponent("Dragón")}`)).toEqual([crimson.id, forest.id]);
    });

    it("requires every word to match", async () => {
      expect(await ids("q=forest+spirit")).toEqual([forest.id]);
      expect(await ids("q=dragon+whale")).toEqual([]);
    });

    it("searches tags, artist names and category names", async () => {
      expect(await ids("q=fantasy")).toEqual([crimson.id]);
      expect(await ids("q=zed")).toEqual([owl.id]);
      expect((await ids("q=character+illustration")).sort()).toEqual([forest.id, owl.id].sort());
    });

    it("ranks a title match above a description match", async () => {
      const whale = await make(artist, { title: "Quiet Pond", description: "A whale visits the pond", color: [90, 90, 90] });
      expect(await ids("q=whale")).toEqual([ocean.id, whale.id]);
    });

    it("returns nothing, safely, for hostile or empty-looking input", async () => {
      expect(await ids("q=xyzzy")).toEqual([]);
      expect(await ids("q=dragon+OR+whale")).toEqual([]);
      for (const hostile of ['"*(^', "'; DROP TABLE listings; --", "NEAR(", "\\"]) {
        const response = await request(ctx.app).get(`/api/search?q=${encodeURIComponent(hostile)}`);
        expect(response.status).toBe(200);
      }
      const punctuationOnly = await search(`q=${encodeURIComponent("***")}`);
      expect(punctuationOnly).toMatchObject({ listings: [], total: 0 });
      expect((await request(ctx.app).get(`/api/search?q=${"x".repeat(101)}`)).status).toBe(400);
    });

    it("treats an empty search box as browsing everything, newest first", async () => {
      const response = await search("q=");
      expect(response.total).toBe(6);
      expect(response.listings.map((l: { id: number }) => l.id)).toEqual([owl.id, rose.id, sunset.id, forest.id, ocean.id, crimson.id]);
      expect((await search("")).total).toBe(6);
    });

    it("echoes the words it searched for", async () => {
      expect((await search("q=Crimson+DRAGON")).tokens).toEqual(["crimson", "dragon"]);
    });
  });

  describe("visibility", () => {
    it("only ever returns publicly visible listings", async () => {
      await make(artist, { title: "Secret Dragon", color: [1, 2, 3], publish: false });
      expect(await ids("q=dragon")).toEqual([crimson.id, forest.id]);

      await artist.post(`/api/listings/${crimson.id}/unpublish`);
      expect(await ids("q=dragon")).toEqual([forest.id]);

      await mod.post(`/api/moderation/listings/${forest.id}/remove`).send({});
      expect(await ids("q=dragon")).toEqual([]);
    });

    it("hides listings of disabled artists", async () => {
      setDisabled(ctx.db, artistId, true);
      expect(await ids("q=dragon")).toEqual([]);
      expect((await search("")).total).toBe(1);
    });
  });

  describe("index maintenance", () => {
    it("follows edits to titles, descriptions and tags", async () => {
      await artist.put(`/api/listings/${crimson.id}`).send({
        title: "Scarlet Wyvern",
        description: "A winged serpent",
        basePriceCents: 50_000,
        licenses: ["commercial"],
        tags: ["wyvern-art"],
      });
      expect(await ids("q=wyvern")).toEqual([crimson.id]);
      expect(await ids("q=crimson")).toEqual([]);
      expect(await ids("q=fantasy")).toEqual([]);
      expect(await ids("q=serpent")).toEqual([crimson.id]);
    });

    it("can be rebuilt from the listings table", async () => {
      ctx.db.prepare("DELETE FROM listing_search").run();
      expect(await ids("q=dragon")).toEqual([]);
      expect(rebuildSearchIndex(ctx.db)).toBe(6);
      expect(await ids("q=dragon")).toEqual([crimson.id, forest.id]);
    });
  });

  describe("filters, sorting and paging", () => {
    it("combines text with the browse filters", async () => {
      expect(await ids("q=dragon&category=illustration")).toEqual([crimson.id]);
      expect(await ids("q=dragon&license=broadcast")).toEqual([forest.id]);
      expect(await ids("q=dragon&maxPriceCents=60000")).toEqual([crimson.id]);
      expect(await ids("q=dragon&minPriceCents=60000")).toEqual([forest.id]);
      expect(await ids("q=dragon&tag=fantasy")).toEqual([crimson.id]);
      expect(await ids(`q=dragon&artist=${artistId}`)).toEqual([crimson.id, forest.id]);
    });

    it("sorts by price or date instead of relevance on request", async () => {
      expect(await ids("q=dragon&sort=price_asc")).toEqual([crimson.id, forest.id]);
      expect(await ids("q=dragon&sort=price_desc")).toEqual([forest.id, crimson.id]);
      expect(await ids("q=dragon&sort=newest")).toEqual([forest.id, crimson.id]);
      expect((await ids("sort=price_asc"))[0]).toBe(sunset.id);
    });

    it("pages results and reports the full total", async () => {
      const page = await search("sort=price_asc&limit=2&offset=2");
      expect(page).toMatchObject({ total: 6, limit: 2, offset: 2 });
      expect(page.listings.map((l: { id: number }) => l.id)).toEqual([rose.id, owl.id]);
    });

    it("rejects invalid parameters", async () => {
      for (const query of ["limit=0", "limit=101", "sort=random", "license=exclusive", "minPriceCents=-1", "tag=Bad%20Tag", "similarTo=abc", "offset=-1"]) {
        expect((await request(ctx.app).get(`/api/search?${query}`)).status).toBe(400);
      }
    });

    it("returns the same listing shape as browsing", async () => {
      const hit = (await search("q=whale")).listings[0];
      expect(hit).toMatchObject({
        id: ocean.id,
        title: "Ocean Whale",
        category: { slug: "illustration" },
        licenses: [{ license: "commercial", priceCents: 50_000 }],
        rating: { count: 0, average: null },
        colorScore: null,
      });
    });
  });

  describe("search by color", () => {
    it("ranks listings by how close their dominant color is", async () => {
      const response = await search("color=dc1414");
      const order = response.listings.map((l: { id: number }) => l.id);
      expect(order[0]).toBe(crimson.id);
      expect(order[1]).toBe(rose.id);
      expect(order).not.toContain(ocean.id);
      expect(order).not.toContain(forest.id);
      expect(response.listings[0].colorScore).toBeGreaterThanOrEqual(950);
      expect(response.listings[1].colorScore).toBeLessThan(response.listings[0].colorScore);
    });

    it("finds blues and greens with their own colors", async () => {
      expect((await ids("color=1428dc"))[0]).toBe(ocean.id);
      expect((await ids("color=14c828"))[0]).toBe(forest.id);
    });

    it("accepts #, short hex and upper case", async () => {
      const expected = await ids("color=dc1414");
      expect(await ids(`color=${encodeURIComponent("#DC1414")}`)).toEqual(expected);
      expect((await ids("color=f00"))[0]).toBe(crimson.id);
    });

    it("rejects bad colors, and color together with similarTo", async () => {
      for (const color of ["red", "12", "gggggg", "%23zzz"]) {
        expect((await request(ctx.app).get(`/api/search?color=${color}`)).status).toBe(400);
      }
      expect((await request(ctx.app).get(`/api/search?color=ff0000&similarTo=${crimson.id}`)).status).toBe(400);
    });

    it("combines with text and filters", async () => {
      const response = await search("q=dragon&color=dc1414");
      expect(response.listings.map((l: { id: number }) => l.id)).toEqual([crimson.id]);
      expect(response.total).toBe(1);
      expect(await ids("color=dc1414&category=character-illustration")).toEqual([]);
      expect(await ids("color=dc1414&maxPriceCents=40000")).toEqual([rose.id, sunset.id]);
    });

    it("can be sorted by price instead of similarity", async () => {
      expect((await ids("color=dc1414&sort=price_desc")).slice(0, 2)).toEqual([crimson.id, rose.id]);
      expect((await ids("color=dc1414&sort=price_asc"))[0]).toBe(sunset.id);
    });

    it("pages the matches and reports how many there are", async () => {
      const all = await search("color=dc1414");
      const second = await search("color=dc1414&limit=1&offset=1");
      expect(second.total).toBe(all.total);
      expect(second.listings.map((l: { id: number }) => l.id)).toEqual([rose.id]);
    });

    it("gives the same answer every time", async () => {
      expect(await search("color=dc1414")).toEqual(await search("color=dc1414"));
    });
  });

  describe("more like this", () => {
    it("ranks other listings by palette similarity and leaves the source out", async () => {
      const order = await ids(`similarTo=${crimson.id}`);
      expect(order[0]).toBe(rose.id);
      expect(order).not.toContain(crimson.id);
      expect(order).not.toContain(ocean.id);
    });

    it("works with text filters", async () => {
      expect(await ids(`similarTo=${crimson.id}&q=garden`)).toEqual([rose.id]);
    });

    it("refuses sources that are not public or have no colors", async () => {
      const draft = await make(artist, { title: "Draft", color: [10, 10, 10], publish: false });
      expect((await request(ctx.app).get(`/api/search?similarTo=${draft.id}`)).status).toBe(404);
      expect((await request(ctx.app).get("/api/search?similarTo=9999")).status).toBe(404);

      const zip = await upload(artist, { category: "live2d", filename: "rig.zip", data: fakeZip(2_000, 7) });
      const rig = await artist.post("/api/listings").send({ assetId: zip.body.asset.id, title: "Rig", basePriceCents: 5_000, licenses: ["commercial"] });
      await artist.post(`/api/listings/${rig.body.listing.id}/publish`);
      const response = await request(ctx.app).get(`/api/search?similarTo=${rig.body.listing.id}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("no_palette");
      expect((await ids("q=rig")).includes(rig.body.listing.id)).toBe(true);
      expect(await ids("color=dc1414")).not.toContain(rig.body.listing.id);
    });
  });

  describe("palettes", () => {
    it("are stored with every image upload and shown on the listing", async () => {
      const view = (await request(ctx.app).get(`/api/listings/${crimson.id}`)).body.listing;
      expect(view.asset.palette).toHaveLength(1);
      expect(view.asset.palette[0].weightBps).toBe(10_000);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(view.asset.palette[0].hex.slice(i, i + 2), 16));
      expect(Math.abs((r as number) - 220)).toBeLessThanOrEqual(2);
      expect(Math.abs((g as number) - 20)).toBeLessThanOrEqual(2);
      expect(Math.abs((b as number) - 20)).toBeLessThanOrEqual(2);
    });

    it("are the same for the same image, and absent for non-images", async () => {
      const again = await upload(zed, { category: "illustration", filename: "same.png", data: await makePng(220, 20, 20) });
      const palette = (id: number) => ctx.db.prepare("SELECT rank, r, g, b, weight_bps FROM asset_colors WHERE asset_id = ? ORDER BY rank").all(id);
      expect(palette(again.body.asset.id)).toEqual(palette(crimson.assetId));
      const zip = await upload(artist, { category: "live2d", filename: "a.zip", data: fakeZip(1_500, 3) });
      expect(palette(zip.body.asset.id)).toEqual([]);
    });

    it("are removed with their asset", async () => {
      const spare = await upload(artist, { category: "illustration", filename: "spare.png", data: await makePng(5, 5, 5) });
      const count = () => ctx.db.prepare("SELECT COUNT(*) AS n FROM asset_colors WHERE asset_id = ?").get(spare.body.asset.id);
      expect(count()).toEqual({ n: 1 });
      expect((await artist.delete(`/api/assets/${spare.body.asset.id}`)).status).toBe(204);
      expect(count()).toEqual({ n: 0 });
    });

    it("can be recomputed from the stored files", async () => {
      const images = ctx.db.prepare("SELECT COUNT(*) AS n FROM assets WHERE mime LIKE 'image/%'").get() as { n: number };
      ctx.db.prepare("DELETE FROM asset_colors").run();
      expect(await ids("color=dc1414")).toEqual([]);
      expect(await backfillPalettes(ctx.db, new LocalStorage(ctx.uploadDir))).toBe(images.n);
      expect((await ids("color=dc1414"))[0]).toBe(crimson.id);
      expect(await backfillPalettes(ctx.db, new LocalStorage(ctx.uploadDir))).toBe(0);
    });
  });
});
